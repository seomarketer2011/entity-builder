/**
 * Conflict tracking persistence — called by /api/internal/analyze on every
 * run so each conflict accumulates a history the operator can read.
 *
 * The decision logic lives in @entity-builder/scoring (pure, tested); this
 * module only reads the previous state, asks the engine what the new
 * status is, and writes the result plus a dated snapshot.
 *
 * Nothing here changes a page, a redirect or a manifest. It records what
 * is happening so a human can decide what to do about it.
 */

import {
  buildObservations,
  classifyConflict,
  isTrackable,
  type ConflictBaseline,
  type ConflictObservation,
  type QueryConflictStatus,
  type QueryPageTotals,
} from "@entity-builder/scoring";

interface ConflictRow {
  id: string;
  query: string;
  status: QueryConflictStatus;
  baseline_impressions: number;
  baseline_owner_share: number | null;
  baseline_contender_count: number;
  peak_contender_count: number;
  resolved_at: string | null;
}

/** Minimal shape of the supabase-js client used here. */
type Db = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};

export interface TrackConflictsResult {
  tracked: number;
  newConflicts: number;
  resolved: number;
  regressed: number;
  collapsed: number;
}

/**
 * A query we are already tracking that has vanished from the window
 * entirely. Zero impressions is a real measurement — it is how "the pages
 * stopped showing" looks — so it must be classified, not skipped.
 */
function emptyObservation(query: string): ConflictObservation {
  return {
    query,
    totalClicks: 0,
    totalImpressions: 0,
    ownerPage: null,
    ownerImpressions: 0,
    ownerShare: 0,
    contenderCount: 0,
    urlCount: 0,
    bestPosition: null,
    contenders: [],
  };
}

export async function trackConflicts(
  db: Db,
  site: { id: string; organisation_id: string },
  rows: QueryPageTotals[],
  window: { from: string; to: string },
): Promise<TrackConflictsResult> {
  // `rows` comes from a globally ordered, row-capped RPC, so it is only
  // safe for DISCOVERING newly contested queries. It must not be used to
  // measure an already-tracked query: that query may have fallen outside
  // the cap, or had only some of its pages survive it, and either would be
  // misread as lost demand and written as a permanent `collapsed`.
  const discovered = buildObservations(rows);

  const { data: existingRows } = await db
    .from("query_conflicts")
    .select(
      "id, query, status, baseline_impressions, baseline_owner_share, " +
        "baseline_contender_count, peak_contender_count, resolved_at",
    )
    .eq("site_id", site.id);
  const existing = new Map<string, ConflictRow>(
    ((existingRows ?? []) as ConflictRow[]).map((r) => [r.query, r]),
  );

  // Everything contested right now, plus everything already tracked (so a
  // conflict that stopped being contested still gets measured — that is
  // the whole point of tracking).
  const queries = new Set<string>([
    ...discovered.filter(isTrackable).map((o) => o.query),
    ...existing.keys(),
  ]);

  // Re-read complete (query, page) rows for exactly these queries. Bounded
  // by the number of tracked conflicts, not by a global row cap, so every
  // measurement below is made on the query's full page set.
  const byQuery = new Map<string, ConflictObservation>();
  const queryList = [...queries];
  const CHUNK = 200;
  let exactFetchFailed = false;
  for (let i = 0; i < queryList.length; i += CHUNK) {
    const chunk = queryList.slice(i, i + CHUNK);
    const { data, error } = await db.rpc("gsc_query_page_totals_for_queries", {
      p_site_id: site.id,
      p_from: window.from,
      p_to: window.to,
      p_queries: chunk,
    });
    if (error) {
      exactFetchFailed = true;
      break;
    }
    for (const o of buildObservations((data ?? []) as QueryPageTotals[])) {
      byQuery.set(o.query, o);
    }
  }

  // Without exact rows we cannot tell "no impressions" from "outside the
  // cap", and guessing would corrupt the history permanently. Fail loudly
  // instead — the caller records it as a note and the run continues.
  if (exactFetchFailed) {
    throw new Error(
      "exact query/page rows unavailable (apply migration 0011: " +
        "gsc_query_page_totals_for_queries) — refusing to write conflict " +
        "history from a truncated result set",
    );
  }

  const result: TrackConflictsResult = {
    tracked: 0,
    newConflicts: 0,
    resolved: 0,
    regressed: 0,
    collapsed: 0,
  };
  const capturedOn = window.to;

  for (const query of queries) {
    const observation = byQuery.get(query) ?? emptyObservation(query);
    const previous = existing.get(query) ?? null;

    const baseline: ConflictBaseline | null = previous
      ? {
          status: previous.status,
          baselineImpressions: Number(previous.baseline_impressions),
          baselineOwnerShare:
            previous.baseline_owner_share == null ? null : Number(previous.baseline_owner_share),
          baselineContenderCount: Number(previous.baseline_contender_count),
          peakContenderCount: Number(previous.peak_contender_count),
        }
      : null;

    const transition = classifyConflict(observation, baseline);
    result.tracked++;
    if (!previous) result.newConflicts++;
    if (transition.status === "resolved" && previous?.status !== "resolved") result.resolved++;
    if (transition.status === "regressed") result.regressed++;
    if (transition.status === "collapsed" && previous?.status !== "collapsed") result.collapsed++;

    const common = {
      status: transition.status,
      owner_page: observation.ownerPage,
      owner_share: observation.ownerShare,
      contender_count: observation.contenderCount,
      total_impressions: observation.totalImpressions,
      total_clicks: observation.totalClicks,
      best_position: observation.bestPosition,
      last_seen_at: new Date().toISOString(),
      note: transition.reason,
    };

    let conflictId: string;
    if (previous) {
      // Baseline is deliberately never rewritten: "have impressions
      // fallen?" must always be measured against first detection.
      const { error } = await db
        .from("query_conflicts")
        .update({
          ...common,
          peak_contender_count: Math.max(
            Number(previous.peak_contender_count),
            observation.contenderCount,
          ),
          ...(transition.status === "resolved" && !previous.resolved_at
            ? { resolved_at: new Date().toISOString() }
            : {}),
          ...(transition.status === "regressed" ? { regressed_at: new Date().toISOString() } : {}),
        })
        .eq("id", previous.id);
      if (error) throw new Error(`conflict update failed: ${error.message}`);
      conflictId = previous.id;
    } else {
      const { data, error } = await db
        .from("query_conflicts")
        .insert({
          organisation_id: site.organisation_id,
          site_id: site.id,
          query,
          ...common,
          baseline_impressions: observation.totalImpressions,
          baseline_owner_share: observation.ownerShare,
          baseline_contender_count: observation.contenderCount,
          peak_contender_count: observation.contenderCount,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`conflict insert failed: ${error?.message}`);
      conflictId = data.id as string;
    }

    // One snapshot per conflict per day; re-running today overwrites
    // today's point rather than stacking duplicates.
    const { error: snapshotError } = await db.from("query_conflict_snapshots").upsert(
      {
        conflict_id: conflictId,
        captured_on: capturedOn,
        status: transition.status,
        owner_page: observation.ownerPage,
        owner_share: observation.ownerShare,
        contender_count: observation.contenderCount,
        total_impressions: observation.totalImpressions,
        total_clicks: observation.totalClicks,
        best_position: observation.bestPosition,
        contenders: observation.contenders,
        window_from: window.from,
        window_to: window.to,
      },
      { onConflict: "conflict_id,captured_on" },
    );
    if (snapshotError) throw new Error(`snapshot failed: ${snapshotError.message}`);
  }

  return result;
}
