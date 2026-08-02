import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Approve or reject mined entity candidates.
 *
 * Approving promotes a candidate out of org-scoped staging into the shared
 * entity graph, recording who decided (rule 3 — a human approves, the
 * system never auto-promotes). Rejecting leaves the row in place marked
 * rejected, so re-running discovery does not resurrect it.
 *
 * Rule 1 is enforced here, not just displayed: a candidate whose site has
 * a `service_not_provided` capability matching it cannot be approved at
 * all. The system must never claim a business does something it does not.
 */
export async function POST(request: Request) {
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    candidateIds?: string[];
    decision?: string;
    /** Optional per-candidate overrides made by the reviewer. */
    overrides?: Record<string, { name?: string; type?: string; parentEntityId?: string; predicate?: string }>;
  };
  const decision = body.decision;
  const candidateIds = body.candidateIds ?? [];
  const overrides = body.overrides ?? {};

  if ((decision !== "approved" && decision !== "rejected") || candidateIds.length === 0) {
    return NextResponse.json({ error: "decision and candidateIds required" }, { status: 400 });
  }
  if (candidateIds.length > 200) {
    return NextResponse.json({ error: "too many candidates in one call" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const db = createSupabaseClient(url, key, { auth: { persistSession: false } });

  // Read through the caller's session first: RLS proves they may touch
  // these rows before the service-role client acts on them.
  const { data: visible } = await session
    .from("entity_candidates")
    .select("id")
    .in("id", candidateIds);
  const allowed = new Set((visible ?? []).map((r) => r.id as string));
  const ids = candidateIds.filter((id) => allowed.has(id));
  if (ids.length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const reviewedAt = new Date().toISOString();

  if (decision === "rejected") {
    const { data, error } = await db
      .from("entity_candidates")
      .update({ status: "rejected", reviewed_by: user.id, reviewed_at: reviewedAt })
      .in("id", ids)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ updated: data?.length ?? 0, decision });
  }

  const { data: candidates, error: loadError } = await db
    .from("entity_candidates")
    .select("*")
    .in("id", ids);
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });

  const approved: string[] = [];
  const blocked: Array<{ id: string; name: string; reason: string }> = [];

  for (const candidate of candidates ?? []) {
    const override = overrides[candidate.id] ?? {};

    if (candidate.capability_supported === false) {
      blocked.push({
        id: candidate.id,
        name: candidate.suggested_name,
        reason:
          "This site's business capabilities record it as NOT provided. " +
          "Update the capability record first if that is wrong.",
      });
      continue;
    }

    const name = (override.name ?? candidate.suggested_name).trim();
    const entityType = override.type ?? candidate.suggested_type;
    if (name.length === 0) {
      blocked.push({ id: candidate.id, name: candidate.suggested_name, reason: "empty name" });
      continue;
    }

    // Reuse an existing entity with this name rather than duplicating it.
    const { data: existing } = await db
      .from("entities")
      .select("id")
      .eq("industry_id", candidate.industry_id)
      .eq("canonical_name", name)
      .maybeSingle();

    let entityId: string;
    if (existing) {
      entityId = existing.id;
    } else {
      const { data: created, error: createError } = await db
        .from("entities")
        .insert({
          industry_id: candidate.industry_id,
          canonical_name: name,
          entity_type: entityType,
          parent_entity_id: override.parentEntityId ?? candidate.suggested_parent_entity_id ?? null,
          status: "approved",
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
        })
        .select("id")
        .single();
      if (createError || !created) {
        blocked.push({
          id: candidate.id,
          name,
          reason: createError?.message ?? "entity insert failed",
        });
        continue;
      }
      entityId = created.id;
    }

    // Evidence for the promotion (non-negotiable rule 2). entity_sources
    // has no unique key on name, so look up before inserting to avoid
    // accumulating a duplicate source row per approval.
    const sourceType = candidate.discovery_source === "gsc_demand" ? "gsc" : "competitor";
    const sourceName =
      candidate.discovery_source === "gsc_demand"
        ? "Search Console demand mining"
        : "Competitor SERP mining (DataForSEO)";

    const { data: existingSource } = await db
      .from("entity_sources")
      .select("id")
      .eq("name", sourceName)
      .limit(1)
      .maybeSingle();
    const sourceId =
      existingSource?.id ??
      (
        await db
          .from("entity_sources")
          .insert({ source_type: sourceType, name: sourceName })
          .select("id")
          .single()
      ).data?.id;

    if (sourceId) {
      await db.from("entity_evidence").insert({
        entity_id: entityId,
        source_id: sourceId,
        excerpt:
          `${candidate.query_count} queries, ${candidate.impressions} impressions. ` +
          `${candidate.capability_note ?? ""}`.trim(),
      });
    }

    // Attach it to the graph where the reviewer said it belongs.
    const parentId = override.parentEntityId ?? candidate.suggested_parent_entity_id ?? null;
    const predicate = override.predicate ?? candidate.suggested_predicate ?? null;
    if (parentId && predicate && parentId !== entityId) {
      const { data: existingRel } = await db
        .from("entity_relationships")
        .select("id")
        .eq("subject_entity_id", parentId)
        .eq("predicate", predicate)
        .eq("object_entity_id", entityId)
        .eq("industry_id", candidate.industry_id)
        .is("location_id", null)
        .maybeSingle();
      if (!existingRel) {
        await db.from("entity_relationships").insert({
          subject_entity_id: parentId,
          predicate,
          object_entity_id: entityId,
          industry_id: candidate.industry_id,
          review_status: "approved",
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
        });
      }
    }

    await db
      .from("entity_candidates")
      .update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: reviewedAt,
        approved_entity_id: entityId,
      })
      .eq("id", candidate.id);
    approved.push(candidate.id);
  }

  return NextResponse.json({
    updated: approved.length,
    decision,
    ...(blocked.length ? { blocked } : {}),
  });
}
