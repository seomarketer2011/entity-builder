import {
  assessCapability,
  buildLocationVocabulary,
  mineEntityCandidates,
  type CapabilityRecord,
  type EntityCandidate,
  type KnownEntity,
  type MinedQuery,
} from "@entity-builder/entity-engine";
import {
  createDataForSeoClient,
  mergeDemandByKeyword,
  normaliseDomain,
  rankedKeywordsAsDemand,
  SERP_LIMITS,
} from "@entity-builder/serp";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Entity discovery: find entities that *should* connect to the site's
 * services and locations but are missing from the graph.
 *
 * Two sources, both landing in `entity_candidates` as proposals:
 *   - gsc_demand:     real query demand no entity covers.
 *   - serp_competitor: keywords competing domains rank for. Needed
 *     because a site earns no impressions for topics it has no page for,
 *     so GSC alone cannot reveal that kind of gap.
 *
 * Nothing is approved here (non-negotiable rule 3) and nothing is written
 * to the shared `entities` graph — candidates are org-scoped staging that
 * a human promotes from the Discovery screen.
 */

const DEMAND_WINDOW_DAYS = 90;
const MAX_CANDIDATES_PER_SOURCE = 60;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("service key not configured");
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}

interface SiteRef {
  id: string;
  organisation_id: string;
  campaign_id: string;
  name: string;
  domain: string;
}

async function upsertCandidates(
  db: ReturnType<typeof admin>,
  site: SiteRef,
  industryId: string | null,
  source: "gsc_demand" | "serp_competitor",
  candidates: EntityCandidate[],
  capabilities: CapabilityRecord[],
): Promise<number> {
  let written = 0;
  for (const candidate of candidates.slice(0, MAX_CANDIDATES_PER_SOURCE)) {
    // Stored as a hint for the reviewer. Approval re-derives it from the
    // capabilities current at that moment — see review-candidate/route.ts.
    const capability = assessCapability(candidate.suggestedName, capabilities);
    const { error } = await db.from("entity_candidates").upsert(
      {
        organisation_id: site.organisation_id,
        site_id: site.id,
        industry_id: industryId,
        discovery_source: source,
        suggested_name: candidate.suggestedName,
        suggested_type: candidate.suggestedType,
        location_name: candidate.locationName,
        impressions: candidate.impressions,
        clicks: candidate.clicks,
        best_position: candidate.bestPosition,
        query_count: candidate.queryCount,
        sample_queries: candidate.sampleQueries,
        capability_supported: capability.supported,
        capability_note: `${candidate.rationale} ${capability.note}`,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "site_id,discovery_source,suggested_name,location_name",
        // Never overwrite a decision a human already made.
        ignoreDuplicates: false,
      },
    );
    if (!error) written++;
  }
  return written;
}

async function discoverForSite(
  db: ReturnType<typeof admin>,
  site: SiteRef,
  industry: { id: string; slug: string },
  useSerp: boolean,
) {
  const notes: string[] = [];

  // The graph as it stands, scoped to the industry being discovered for.
  // Without the filter an entity from an unrelated industry would count as
  // coverage and silently suppress a valid proposal. industry_id IS NULL
  // means cross-industry (see migration 0004), so those still count.
  const { data: entityRows } = await db
    .from("entities")
    .select("id, canonical_name, entity_type, status, industry_id, entity_aliases(alias)")
    .neq("status", "rejected")
    .or(`industry_id.eq.${industry.id},industry_id.is.null`);
  const entities: KnownEntity[] = (entityRows ?? []).map((e: any) => ({
    id: e.id,
    canonicalName: e.canonical_name,
    entityType: e.entity_type,
    aliases: (e.entity_aliases ?? []).map((a: any) => a.alias),
  }));
  const industryId = industry.id;

  const { data: capabilityRows } = await db
    .from("business_capabilities")
    .select("kind, value")
    .eq("site_id", site.id);
  const capabilities = (capabilityRows ?? []) as CapabilityRecord[];

  // Locations the operator actually works in (rule 1 applies to places as
  // much as services): site names, declared geographic limits, and any
  // locations already in the graph.
  const { data: locationRows } = await db.from("locations").select("name");
  const locationVocabulary = buildLocationVocabulary({
    siteNames: [site.name],
    capabilityValues: capabilities
      .filter((c) => c.kind === "geographic_limit")
      .map((c) => c.value),
    locationNames: (locationRows ?? []).map((l: any) => l.name as string),
  });

  // --- source 1: this site's own Search Console demand --------------------
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - DEMAND_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const { data: totals, error: totalsError } = await db.rpc("gsc_query_totals", {
    p_site_id: site.id,
    p_from: from,
    p_to: today,
    p_limit: 1000,
  });

  let gscWritten = 0;
  if (totalsError) {
    notes.push(`gsc_demand skipped: ${totalsError.message}`);
  } else {
    const queries = ((totals ?? []) as MinedQuery[]).map((q) => ({
      query: q.query,
      clicks: Number(q.clicks),
      impressions: Number(q.impressions),
      position: q.position == null ? null : Number(q.position),
    }));
    const mined = mineEntityCandidates(queries, entities, {
      siteDomain: site.domain,
      locationVocabulary,
    });
    gscWritten = await upsertCandidates(
      db,
      site,
      industryId,
      "gsc_demand",
      mined,
      capabilities,
    );
  }

  // --- source 2: what competitors rank for --------------------------------
  let serpWritten = 0;
  let serpCost = 0;
  if (useSerp) {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) {
      notes.push("serp_competitor skipped: DATAFORSEO_LOGIN/PASSWORD not configured");
    } else {
      const client = createDataForSeoClient({
        fetchImpl: fetch as never,
        credentials: { login, password },
        callBudget: SERP_LIMITS.maxCallsPerRun,
      });
      try {
        const competitors = await client.competitorDomains(site.domain, {
          limit: SERP_LIMITS.maxCompetitors,
        });
        const targets = competitors
          .map((c) => normaliseDomain(c.domain))
          .filter((d) => d !== normaliseDomain(site.domain))
          .slice(0, SERP_LIMITS.maxCompetitors);

        // Competitors overlap heavily, so the same keyword comes back
        // from several domains. mergeDemandByKeyword collapses those to
        // one row — see its comment for why summing would be wrong.
        const collected: MinedQuery[] = [];
        for (const target of targets) {
          const keywords = await client.rankedKeywords(target, { maxRank: 20 });
          collected.push(...rankedKeywordsAsDemand(keywords));
        }
        const demand: MinedQuery[] = mergeDemandByKeyword(collected);

        if (demand.length > 0) {
          const mined = mineEntityCandidates(demand, entities, {
            siteDomain: site.domain,
            locationVocabulary,
          });
          serpWritten = await upsertCandidates(
            db,
            site,
            industryId,
            "serp_competitor",
            mined,
            capabilities,
          );
        }
        serpCost = client.costUsed();
        if (targets.length === 0) notes.push("serp_competitor: no competitor domains returned");
      } catch (error) {
        notes.push(
          `serp_competitor failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
        serpCost = client.costUsed();
      }
    }
  }

  return {
    site: site.name,
    gscCandidates: gscWritten,
    serpCandidates: serpWritten,
    ...(serpCost > 0 ? { serpCostUsd: Number(serpCost.toFixed(4)) } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaign");
  const siteId = url.searchParams.get("site");
  // SERP mining costs real money per call, so it is opt-in per run.
  const useSerp = url.searchParams.get("serp") === "1";

  const expected = process.env.SYNC_TOKEN;
  const isCron = !!expected && request.headers.get("authorization") === `Bearer ${expected}`;

  let db;
  try {
    db = admin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "config" },
      { status: 503 },
    );
  }

  if (!isCron) {
    if (!campaignId) return NextResponse.json({ error: "campaign required" }, { status: 400 });
    const session = await createClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // RLS: only returns the campaign if the caller is an org member.
    const { data: campaign } = await session
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .single();
    if (!campaign) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Discovery must run against one named industry: coverage is judged
  // against that industry's graph, and approved candidates are created in
  // it. Inferring it would mean guessing, and guessing wrong files entities
  // under the wrong industry.
  const industrySlug = url.searchParams.get("industry");
  const { data: industries } = await db.from("industries").select("id, slug").order("slug");
  const available = (industries ?? []) as Array<{ id: string; slug: string }>;

  const resolved = industrySlug
    ? available.find((i) => i.slug === industrySlug)
    : available.length === 1
      ? available[0] // unambiguous
      : undefined;

  let industry: { id: string; slug: string };
  if (resolved) {
    industry = resolved;
  } else if (industrySlug) {
    return NextResponse.json(
      { error: `unknown industry: ${industrySlug}`, available: available.map((i) => i.slug) },
      { status: 400 },
    );
  } else if (available.length === 0) {
    return NextResponse.json(
      { error: "no industry graph imported yet — import one on the Entity graph page first" },
      { status: 400 },
    );
  } else {
    return NextResponse.json(
      {
        error: "industry required when more than one industry graph exists",
        available: available.map((i) => i.slug),
      },
      { status: 400 },
    );
  }

  let query = db.from("sites").select("id, organisation_id, campaign_id, name, domain");
  if (campaignId) query = query.eq("campaign_id", campaignId);
  if (siteId) query = query.eq("id", siteId);
  const { data: sites } = await query;

  const results = [];
  for (const site of (sites ?? []) as SiteRef[]) {
    try {
      results.push(await discoverForSite(db, site, industry, useSerp));
    } catch (error) {
      results.push({
        site: site.name,
        error: error instanceof Error ? error.message : "failed",
      });
    }
  }
  return NextResponse.json({ industry: industry.slug, discovered: results });
}
