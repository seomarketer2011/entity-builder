/**
 * Opportunity detectors V1 — docs/OPPORTUNITY_RULES.md.
 * Pure functions over aggregated GSC query totals. Every emitted finding
 * carries the input row as evidence and component scores for the priority
 * engine. Thresholds here are canonical; the doc must match.
 */

import { scoreOpportunity, type OpportunityPriorityResult } from "./opportunity-score.js";

/** One aggregated query row for a site over the analysis window. */
export interface QueryTotals {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number | null;
}

/**
 * Expected CTR by position — industry-average organic curve, used until a
 * site has enough click data to fit its own (Phase 2.1).
 */
export const EXPECTED_CTR: ReadonlyArray<{ maxPosition: number; ctr: number }> = [
  { maxPosition: 1, ctr: 0.28 },
  { maxPosition: 2, ctr: 0.15 },
  { maxPosition: 3, ctr: 0.11 },
  { maxPosition: 4, ctr: 0.08 },
  { maxPosition: 5, ctr: 0.07 },
  { maxPosition: 6, ctr: 0.05 },
  { maxPosition: 7, ctr: 0.04 },
  { maxPosition: 8, ctr: 0.03 },
  { maxPosition: 9, ctr: 0.025 },
  { maxPosition: 10, ctr: 0.022 },
];

export function expectedCtr(position: number): number {
  const bucket = EXPECTED_CTR.find((b) => position <= b.maxPosition);
  return bucket ? bucket.ctr : 0;
}

export const STRIKING_DISTANCE = {
  minPosition: 4,
  maxPosition: 20,
  minImpressions: 50, // over the analysis window (28 days)
} as const;

export const CTR_GAP = {
  maxPosition: 10,
  minImpressions: 100,
  /** flag when actual CTR is below this fraction of expected */
  gapFraction: 0.5,
} as const;

export interface DetectorFinding {
  type: "striking_distance" | "ctr_gap";
  query: string;
  title: string;
  explanation: string;
  recommendedAction: string;
  evidence: QueryTotals;
  priority: OpportunityPriorityResult;
}

function trafficPotentialFromImpressions(impressions: number): number {
  // log-ish scale: 50 → ~40, 500 → ~70, 5000 → ~100
  return Math.min(100, Math.round(Math.log10(Math.max(impressions, 1)) * 33));
}

export function detectStrikingDistance(rows: QueryTotals[]): DetectorFinding[] {
  return rows
    .filter(
      (r) =>
        r.position != null &&
        r.position >= STRIKING_DISTANCE.minPosition &&
        r.position <= STRIKING_DISTANCE.maxPosition &&
        r.impressions >= STRIKING_DISTANCE.minImpressions,
    )
    .map((r) => {
      const position = r.position!;
      // Closer to page 1 = easier win.
      const ease = Math.round(100 - ((position - 4) / 16) * 60);
      const priority = scoreOpportunity({
        trafficPotential: trafficPotentialFromImpressions(r.impressions),
        confidence: 85, // direct GSC measurement
        commercialValue: 70, // refined by entity/intent data in Phase 3
        pageRelevance: 75, // Google already ranks the site for it
        strategicFit: 70,
        implementationEase: ease,
        networkApplicability: 30,
      });
      return {
        type: "striking_distance" as const,
        query: r.query,
        title: `Within reach: "${r.query}" at position ${position.toFixed(1)}`,
        explanation:
          `"${r.query}" earned ${r.impressions} impressions in the window at average ` +
          `position ${position.toFixed(1)}. Positions 4–20 are striking distance: the site ` +
          `already half-ranks, so on-page improvements can reach page-one clicks.`,
        recommendedAction:
          "Strengthen the page that appears for this query: cover the missing subtopics, " +
          "improve the title and headings to match the dominant intent, and add internal " +
          "links from related pages.",
        evidence: r,
        priority,
      };
    });
}

export function detectCtrGap(rows: QueryTotals[]): DetectorFinding[] {
  return rows
    .filter((r) => {
      if (r.position == null || r.position > CTR_GAP.maxPosition) return false;
      if (r.impressions < CTR_GAP.minImpressions) return false;
      return r.ctr < expectedCtr(r.position) * CTR_GAP.gapFraction;
    })
    .map((r) => {
      const position = r.position!;
      const expected = expectedCtr(position);
      const missedClicks = Math.round(r.impressions * (expected - r.ctr));
      const priority = scoreOpportunity({
        trafficPotential: trafficPotentialFromImpressions(missedClicks * 10),
        confidence: 90,
        commercialValue: 70,
        pageRelevance: 90, // already ranking top 10
        strategicFit: 70,
        implementationEase: 90, // title/description rewrite
        networkApplicability: 30,
      });
      return {
        type: "ctr_gap" as const,
        query: r.query,
        title: `Weak CTR for "${r.query}" despite position ${position.toFixed(1)}`,
        explanation:
          `"${r.query}": ${r.impressions} impressions at position ${position.toFixed(1)} ` +
          `earned CTR ${(r.ctr * 100).toFixed(1)}% vs ~${(expected * 100).toFixed(1)}% expected ` +
          `at that position — roughly ${missedClicks} clicks left on the table in the window.`,
        recommendedAction:
          "Rewrite the title and meta description of the ranking page to match this query's " +
          "intent — include the service and location plainly, add a commercial qualifier " +
          "(e.g. certified, 24hr, free survey) and keep the title under ~60 characters.",
        evidence: r,
        priority,
      };
    });
}

export function runDetectors(rows: QueryTotals[]): DetectorFinding[] {
  // A query in striking distance can't also have a top-10 CTR gap, so the
  // two sets are disjoint by construction (position ranges do not overlap
  // except positions 4–10, where CTR-gap wins if both fire).
  const ctrGaps = detectCtrGap(rows);
  const flagged = new Set(ctrGaps.map((f) => f.query));
  const striking = detectStrikingDistance(rows).filter((f) => !flagged.has(f.query));
  return [...ctrGaps, ...striking].sort((a, b) => b.priority.overall - a.priority.overall);
}
