/**
 * Query conflict lifecycle — docs/OPPORTUNITY_RULES.md §Cannibalisation tracking.
 *
 * The cannibalisation detector says "these pages compete right now".
 * This module answers the follow-up question: *is it getting better?*
 *
 * A conflict is tracked per (site, query), not per page-set. When a losing
 * page drops out the page-set changes but the query does not — keying on
 * the query is what lets "this conflict resolved" be distinguished from
 * "a different conflict appeared".
 *
 * The important subtlety: contention disappearing is NOT automatically a
 * win. If both pages stopped showing because the query lost all its
 * demand, the conflict is `collapsed`, not `resolved`. Every status below
 * is measured against the baseline captured at first detection, never
 * against the previous run, so a slow multi-week decline cannot be
 * mistaken for a fix.
 *
 * Pure functions; thresholds here are canonical and the doc must match.
 */

import { CANNIBALISATION } from "./detectors-v2.js";
import type { QueryPageTotals } from "./detectors-v2.js";

export const CONFLICT_LIFECYCLE = {
  /** A query is only tracked once it clears the detector's noise floor. */
  minQueryImpressions: CANNIBALISATION.minQueryImpressions,
  /** Impression share at which a page counts as a contender. */
  minShare: CANNIBALISATION.minShare,
  /** Owner share that must be EXCEEDED before a conflict can be resolved. */
  resolvedOwnerShare: 0.75,
  /**
   * Fraction of baseline impressions the query must retain for an
   * improvement to count as real. Below this the contention has gone
   * because the demand went, which is a loss, not a fix.
   */
  impressionRetention: 0.85,
  /** Owner share gain (percentage points / 100) that counts as improving. */
  improvingShareGain: 0.1,
} as const;

export type QueryConflictStatus =
  | "new"
  | "ongoing"
  | "improving"
  | "resolved"
  | "collapsed"
  | "regressed";

export interface ConflictContender {
  page: string;
  clicks: number;
  impressions: number;
  share: number;
  position: number | null;
}

/** One measurement of a query at a point in time. */
export interface ConflictObservation {
  query: string;
  totalClicks: number;
  totalImpressions: number;
  ownerPage: string | null;
  ownerImpressions: number;
  ownerShare: number;
  contenderCount: number;
  urlCount: number;
  bestPosition: number | null;
  contenders: ConflictContender[];
}

/** The stored state of a conflict from previous runs. */
export interface ConflictBaseline {
  status: QueryConflictStatus;
  baselineImpressions: number;
  baselineOwnerShare: number | null;
  baselineContenderCount: number;
  peakContenderCount: number;
}

export interface ConflictTransition {
  status: QueryConflictStatus;
  /** Operator-facing sentence explaining why the status is what it is. */
  reason: string;
  demandRetained: boolean;
  /** Owner share change vs baseline, in points (0.12 = +12pp). Null when new. */
  shareDelta: number | null;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Threshold comparisons run on values derived by subtracting/multiplying
 * fractions, where IEEE-754 dust makes exact boundaries unreliable
 * (0.7 - 0.6 = 0.09999999999999998, which would miss a genuine 10-point
 * gain). Every threshold test below goes through this.
 */
const EPSILON = 1e-9;

function atLeast(value: number, threshold: number): boolean {
  return value >= threshold - EPSILON;
}

/**
 * Roll (query, page) rows up into per-query observations. Mirrors the
 * gsc_query_owner_totals SQL function so the analyzer and the Explorer
 * agree on who owns a query.
 */
export function buildObservations(rows: QueryPageTotals[]): ConflictObservation[] {
  const byQuery = new Map<string, QueryPageTotals[]>();
  for (const row of rows) {
    const list = byQuery.get(row.query) ?? [];
    list.push(row);
    byQuery.set(row.query, list);
  }

  const observations: ConflictObservation[] = [];
  for (const [query, pages] of byQuery) {
    const totalImpressions = pages.reduce((s, p) => s + p.impressions, 0);
    const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);
    const sorted = [...pages].sort(
      (a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page),
    );
    const owner = sorted[0] ?? null;
    const share = (p: QueryPageTotals) =>
      totalImpressions > 0 ? p.impressions / totalImpressions : 0;
    const contenders = sorted.filter((p) => share(p) >= CONFLICT_LIFECYCLE.minShare);

    observations.push({
      query,
      totalClicks,
      totalImpressions,
      ownerPage: owner?.page ?? null,
      ownerImpressions: owner?.impressions ?? 0,
      ownerShare: owner ? share(owner) : 0,
      contenderCount: contenders.length,
      urlCount: pages.length,
      bestPosition: sorted.reduce<number | null>(
        (best, p) =>
          p.position == null ? best : best == null ? p.position : Math.min(best, p.position),
        null,
      ),
      contenders: contenders.map((p) => ({
        page: p.page,
        clicks: p.clicks,
        impressions: p.impressions,
        share: share(p),
        position: p.position,
      })),
    });
  }
  return observations.sort((a, b) => b.totalImpressions - a.totalImpressions);
}

/** True when a query is contested enough to start tracking it. */
export function isTrackable(observation: ConflictObservation): boolean {
  return (
    observation.totalImpressions >= CONFLICT_LIFECYCLE.minQueryImpressions &&
    observation.contenderCount >= 2
  );
}

/**
 * Classify a conflict given the newest observation and its stored
 * baseline. Pass `null` for a conflict being seen for the first time.
 *
 * Rule order matters and is deliberate:
 *   1. first sighting                       -> new
 *   2. previously resolved, contested again -> regressed
 *   3. owner dominant + demand retained     -> resolved
 *   4. owner dominant, demand fell          -> collapsed
 *   5. contention gone, demand fell         -> collapsed
 *   6. contention gone, demand retained     -> improving
 *   7. still contested, measurably better   -> improving
 *   8. otherwise                            -> ongoing
 */
export function classifyConflict(
  observation: ConflictObservation,
  baseline: ConflictBaseline | null,
): ConflictTransition {
  if (baseline === null) {
    return {
      status: "new",
      reason:
        `${observation.contenderCount} pages each take at least ` +
        `${pct(CONFLICT_LIFECYCLE.minShare)} of this query's ${observation.totalImpressions} ` +
        `impressions. Newly detected — this run is the baseline.`,
      demandRetained: true,
      shareDelta: null,
    };
  }

  const contested = observation.contenderCount >= 2;
  const dominant = observation.ownerShare > CONFLICT_LIFECYCLE.resolvedOwnerShare;
  const demandRetained = atLeast(
    observation.totalImpressions,
    baseline.baselineImpressions * CONFLICT_LIFECYCLE.impressionRetention,
  );
  const shareDelta =
    baseline.baselineOwnerShare == null
      ? null
      : observation.ownerShare - baseline.baselineOwnerShare;

  const demandNote =
    `Impressions ${observation.totalImpressions} vs ${baseline.baselineImpressions} ` +
    `at first detection.`;

  if (baseline.status === "resolved" && contested) {
    return {
      status: "regressed",
      reason:
        `This conflict was resolved and is contested again — ${observation.contenderCount} ` +
        `pages are back above ${pct(CONFLICT_LIFECYCLE.minShare)} share. ${demandNote}`,
      demandRetained,
      shareDelta,
    };
  }

  if (dominant) {
    return demandRetained
      ? {
          status: "resolved",
          reason:
            `${observation.ownerPage} now takes ${pct(observation.ownerShare)} of the query ` +
            `(above the ${pct(CONFLICT_LIFECYCLE.resolvedOwnerShare)} threshold) and demand ` +
            `held up. ${demandNote}`,
          demandRetained,
          shareDelta,
        }
      : {
          status: "collapsed",
          reason:
            `${observation.ownerPage} now takes ${pct(observation.ownerShare)} of the query, ` +
            `but only because the query lost impressions — this is not a fix. ${demandNote}`,
          demandRetained,
          shareDelta,
        };
  }

  if (!contested) {
    return demandRetained
      ? {
          status: "improving",
          reason:
            `Only one page now clears ${pct(CONFLICT_LIFECYCLE.minShare)} share, but ` +
            `${observation.ownerPage} holds just ${pct(observation.ownerShare)} — not yet the ` +
            `${pct(CONFLICT_LIFECYCLE.resolvedOwnerShare)} needed to call it resolved. ${demandNote}`,
          demandRetained,
          shareDelta,
        }
      : {
          status: "collapsed",
          reason:
            `The competing pages stopped showing, but the query's impressions fell below ` +
            `${pct(CONFLICT_LIFECYCLE.impressionRetention)} of the baseline — the contention ` +
            `went because the demand went. ${demandNote}`,
          demandRetained,
          shareDelta,
        };
  }

  const fewerContenders = observation.contenderCount < baseline.baselineContenderCount;
  const shareGained =
    shareDelta != null && atLeast(shareDelta, CONFLICT_LIFECYCLE.improvingShareGain);

  if ((fewerContenders || shareGained) && demandRetained) {
    const parts: string[] = [];
    if (fewerContenders) {
      parts.push(
        `contenders down from ${baseline.baselineContenderCount} to ${observation.contenderCount}`,
      );
    }
    if (shareGained && shareDelta != null) {
      parts.push(`owner share up ${Math.round(shareDelta * 100)} points`);
    }
    return {
      status: "improving",
      reason: `Moving the right way — ${parts.join(", ")}. Still contested. ${demandNote}`,
      demandRetained,
      shareDelta,
    };
  }

  return {
    status: "ongoing",
    reason:
      `Still contested: ${observation.contenderCount} pages above ` +
      `${pct(CONFLICT_LIFECYCLE.minShare)} share, owner ${observation.ownerPage} on ` +
      `${pct(observation.ownerShare)}. No material change yet. ${demandNote}`,
    demandRetained,
    shareDelta,
  };
}

/** Statuses that still want the operator's attention. */
export const OPEN_CONFLICT_STATUSES: readonly QueryConflictStatus[] = [
  "new",
  "ongoing",
  "improving",
  "regressed",
  "collapsed",
] as const;

export function isOpenStatus(status: QueryConflictStatus): boolean {
  return OPEN_CONFLICT_STATUSES.includes(status);
}
