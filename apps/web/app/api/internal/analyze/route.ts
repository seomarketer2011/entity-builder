import {
  detectCannibalisation,
  detectDecliningPages,
  detectUnownedClusters,
  runDetectors,
  type FindingV2,
  type PageTotals,
  type QueryPageTotals,
  type QueryTotals,
} from "@entity-builder/scoring";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { trackConflicts, type TrackConflictsResult } from "@/lib/conflicts";
import { createClient } from "@/lib/supabase/server";

/**
 * Opportunity analysis (V1 detectors). Two callers:
 *  - the cron worker (bearer SYNC_TOKEN) — analyses every linked site
 *  - a signed-in user (?campaign=...) — analyses their own campaign now
 * Each run regenerates OPEN V1 opportunities per site; accepted/dismissed
 * rows are never touched. Every opportunity stores its evidence rows and
 * component scores (non-negotiable rule 2).
 */

const WINDOW_DAYS = 28;
const DETECTOR_VERSION = "v1";

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

async function analyseSite(db: ReturnType<typeof admin>, site: SiteRef) {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

  const prevFrom = new Date(today.getTime() - 2 * WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  const { data: totals, error } = await db.rpc("gsc_query_totals", {
    p_site_id: site.id,
    p_from: from,
    p_to: to,
    p_limit: 1000,
  });
  if (error) throw new Error(`aggregation failed for ${site.name}: ${error.message}`);
  const queryTotals = (totals ?? []) as QueryTotals[];

  const v1 = runDetectors(queryTotals, { siteDomain: site.domain });

  // V2 detectors — each degrades gracefully if its inputs are unavailable.
  const v2: FindingV2[] = [];
  const notes: string[] = [];

  const [currentPages, previousPages] = await Promise.all([
    db.rpc("gsc_page_totals", { p_site_id: site.id, p_from: from, p_to: to, p_limit: 1000 }),
    db.rpc("gsc_page_totals", { p_site_id: site.id, p_from: prevFrom, p_to: from, p_limit: 1000 }),
  ]);
  if (!currentPages.error && !previousPages.error) {
    v2.push(
      ...detectDecliningPages(
        (currentPages.data ?? []) as PageTotals[],
        (previousPages.data ?? []) as PageTotals[],
      ),
    );
  } else {
    notes.push("declining_page skipped: page totals unavailable");
  }

  const queryPage = await db.rpc("gsc_query_page_totals", {
    p_site_id: site.id,
    p_from: from,
    p_to: to,
    p_limit: 3000,
  });
  let conflicts: TrackConflictsResult | null = null;
  if (!queryPage.error) {
    const pairs = (queryPage.data ?? []) as QueryPageTotals[];
    v2.push(...detectCannibalisation(pairs));
    // Record how each conflict is moving over time. Independent of the
    // opportunity feed: opportunities are regenerated every run, whereas
    // conflict history must accumulate.
    try {
      conflicts = await trackConflicts(db, site, pairs, { from, to });
    } catch (error) {
      notes.push(
        `conflict tracking skipped: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  } else {
    notes.push("cannibalisation skipped: apply migration 0010 (gsc_query_page_totals)");
  }

  v2.push(...detectUnownedClusters(queryTotals, { siteDomain: site.domain }));

  const findings = [
    ...v1.map((f) => ({
      type: f.type as string,
      title: f.title,
      explanation: f.explanation,
      recommendedAction: f.recommendedAction,
      evidence: { window: { from, to }, queryTotals: f.evidence },
      priority: f.priority,
    })),
    ...v2.map((f) => ({
      type: f.type as string,
      title: f.title,
      explanation: f.explanation,
      recommendedAction: f.recommendedAction,
      evidence: { window: { from, to }, ...(f.evidence as object) },
      priority: f.priority,
    })),
  ];

  // Regenerate open V1 opportunities for this site.
  await db
    .from("opportunities")
    .delete()
    .eq("site_id", site.id)
    .eq("status", "open")
    .eq("detector_version", DETECTOR_VERSION);

  for (const finding of findings) {
    const { data: opportunity, error: insertError } = await db
      .from("opportunities")
      .insert({
        organisation_id: site.organisation_id,
        campaign_id: site.campaign_id,
        site_id: site.id,
        type: finding.type,
        detector_version: DETECTOR_VERSION,
        title: finding.title,
        explanation: finding.explanation,
        recommended_action: finding.recommendedAction,
        status: "open",
        priority: finding.priority.overall,
      })
      .select("id")
      .single();
    if (insertError || !opportunity) throw new Error(insertError?.message ?? "insert failed");

    await db.from("opportunity_evidence").insert({
      opportunity_id: opportunity.id,
      kind: "gsc_rows",
      payload: finding.evidence,
    });
    await db.from("opportunity_scores").insert({
      opportunity_id: opportunity.id,
      traffic_potential: finding.priority.components.trafficPotential,
      confidence: finding.priority.components.confidence,
      commercial_value: finding.priority.components.commercialValue,
      page_relevance: finding.priority.components.pageRelevance,
      strategic_fit: finding.priority.components.strategicFit,
      implementation_ease: finding.priority.components.implementationEase,
      network_applicability: finding.priority.components.networkApplicability,
      overall: finding.priority.overall,
    });
  }

  return {
    site: site.name,
    findings: findings.length,
    ...(conflicts ? { conflicts } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaign");
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

  let siteFilter: { campaign_id?: string } = {};
  if (!isCron) {
    // Signed-in path: verify the caller is a member of the campaign's org.
    if (!campaignId) return NextResponse.json({ error: "campaign required" }, { status: 400 });
    const session = await createClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { data: campaign } = await session
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .single(); // RLS: only returns it if the user is an org member
    if (!campaign) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    siteFilter = { campaign_id: campaignId };
  } else if (campaignId) {
    siteFilter = { campaign_id: campaignId };
  }

  let query = db.from("sites").select("id, organisation_id, campaign_id, name, domain");
  if (siteFilter.campaign_id) query = query.eq("campaign_id", siteFilter.campaign_id);
  const { data: sites } = await query;

  const results = [];
  for (const site of (sites ?? []) as SiteRef[]) {
    try {
      results.push(await analyseSite(db, site));
    } catch (error) {
      results.push({ site: site.name, error: error instanceof Error ? error.message : "failed" });
    }
  }
  return NextResponse.json({ analysed: results });
}
