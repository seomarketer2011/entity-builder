/**
 * Opportunity detectors V2 — docs/OPPORTUNITY_RULES.md.
 * declining_page, cannibalisation, unowned_cluster. Pure functions;
 * thresholds here are canonical and the doc must match.
 */

import { isBrandedQuery, type QueryTotals } from "./detectors.js";
import { scoreOpportunity, type OpportunityPriorityResult } from "./opportunity-score.js";

export interface PageTotals {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

export interface QueryPageTotals extends PageTotals {
  query: string;
}

export interface FindingV2 {
  type: "declining_page" | "cannibalisation" | "unowned_cluster";
  subject: string;
  title: string;
  explanation: string;
  recommendedAction: string;
  evidence: unknown;
  priority: OpportunityPriorityResult;
}

export const DECLINING_PAGE = {
  minPreviousClicks: 20,
  /** current clicks below this fraction of previous = declining */
  dropFraction: 0.7,
} as const;

export const CANNIBALISATION = {
  minQueryImpressions: 50,
  /** a page is a contender when it takes at least this share of the query's impressions */
  minShare: 0.25,
} as const;

export const UNOWNED_CLUSTER = {
  minMembers: 2,
  minImpressions: 150,
  /** cluster counts as unowned when its best-ranking member is beyond this */
  minBestPosition: 25,
  similarityThreshold: 0.5,
} as const;

function pot(value: number): number {
  return Math.min(100, Math.round(Math.log10(Math.max(value, 1)) * 33));
}

export function detectDecliningPages(
  current: PageTotals[],
  previous: PageTotals[],
): FindingV2[] {
  const currentByPage = new Map(current.map((p) => [p.page, p]));
  const findings: FindingV2[] = [];
  for (const prev of previous) {
    if (prev.clicks < DECLINING_PAGE.minPreviousClicks) continue;
    const now = currentByPage.get(prev.page);
    const nowClicks = now?.clicks ?? 0;
    if (nowClicks >= prev.clicks * DECLINING_PAGE.dropFraction) continue;
    const dropPct = Math.round((1 - nowClicks / prev.clicks) * 100);
    findings.push({
      type: "declining_page",
      subject: prev.page,
      title: `Declining: ${prev.page} (-${dropPct}% clicks)`,
      explanation:
        `${prev.page} fell from ${prev.clicks} to ${nowClicks} clicks between the previous ` +
        `and current 28-day windows (position ${prev.position?.toFixed(1) ?? "?"} → ` +
        `${now?.position?.toFixed(1) ?? "gone"}). Sustained drops usually mean fresher or ` +
        `more complete competing pages, or lost internal links.`,
      recommendedAction:
        "Compare the page against the pages now outranking it: update stale facts and dates, " +
        "fill missing subtopics, check the page still has prominent internal links, and " +
        "confirm nothing technical changed (noindex, redirects, speed).",
      evidence: { previous: prev, current: now ?? null },
      priority: scoreOpportunity({
        trafficPotential: pot((prev.clicks - nowClicks) * 12),
        confidence: 80,
        commercialValue: 70,
        pageRelevance: 90,
        strategicFit: 80,
        implementationEase: 60,
        networkApplicability: 30,
      }),
    });
  }
  return findings;
}

export function detectCannibalisation(rows: QueryPageTotals[]): FindingV2[] {
  const byQuery = new Map<string, QueryPageTotals[]>();
  for (const row of rows) {
    const list = byQuery.get(row.query) ?? [];
    list.push(row);
    byQuery.set(row.query, list);
  }

  // Per-query contender detection, then grouped by the SET of competing
  // pages: one finding per page conflict, not one per query variant.
  interface Conflict {
    pages: string[];
    queries: Array<{ query: string; impressions: number; contenders: QueryPageTotals[] }>;
    totalImpressions: number;
  }
  const conflicts = new Map<string, Conflict>();

  for (const [query, pages] of byQuery) {
    const total = pages.reduce((s, p) => s + p.impressions, 0);
    if (total < CANNIBALISATION.minQueryImpressions) continue;
    const contenders = pages
      .filter((p) => p.impressions / total >= CANNIBALISATION.minShare)
      .sort((a, b) => b.impressions - a.impressions);
    if (contenders.length < 2) continue;
    const key = contenders
      .map((c) => c.page)
      .sort()
      .join(" | ");
    const conflict = conflicts.get(key) ?? {
      pages: contenders.map((c) => c.page).sort(),
      queries: [],
      totalImpressions: 0,
    };
    conflict.queries.push({ query, impressions: total, contenders });
    conflict.totalImpressions += total;
    conflicts.set(key, conflict);
  }

  const findings: FindingV2[] = [];
  for (const conflict of conflicts.values()) {
    conflict.queries.sort((a, b) => b.impressions - a.impressions);
    const sample = conflict.queries.slice(0, 4).map((q) => `"${q.query}"`).join(", ");
    const queryCount = conflict.queries.length;
    findings.push({
      type: "cannibalisation",
      subject: conflict.pages.join(" | "),
      title:
        `Cannibalisation: ${conflict.pages.length} pages compete over ` +
        `${queryCount} quer${queryCount === 1 ? "y" : "ies"} (${sample})`,
      explanation:
        `These pages split the same search demand (${conflict.totalImpressions} impressions ` +
        `across ${queryCount} quer${queryCount === 1 ? "y" : "ies"}): ` +
        conflict.pages.join(" vs ") +
        `. Google is unsure which page to rank, which usually caps all of them below their ` +
        `potential. Top queries affected: ${sample}.`,
      recommendedAction:
        "Decide which page owns this intent. Either consolidate the weaker page into the " +
        "stronger one (redirect), differentiate their intents clearly (and retitle), or fix " +
        "internal anchor text so links for this topic all point at the owner.",
      evidence: {
        pages: conflict.pages,
        totalImpressions: conflict.totalImpressions,
        queries: conflict.queries,
      },
      priority: scoreOpportunity({
        trafficPotential: pot(conflict.totalImpressions),
        confidence: 85,
        commercialValue: 70,
        pageRelevance: 85,
        strategicFit: 80,
        implementationEase: 55,
        networkApplicability: 40,
      }),
    });
  }
  return findings.sort((a, b) => b.priority.overall - a.priority.overall);
}

// -- lexical query clustering (token Jaccard, greedy) --------------------

const STOP = new Set(["a", "an", "the", "of", "for", "in", "to", "near", "me", "and", "&"]);

function tokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => (w.endsWith("s") && !w.endsWith("ss") && w.length > 3 ? w.slice(0, -1) : w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface QueryCluster {
  label: string;
  members: QueryTotals[];
  totalImpressions: number;
  bestPosition: number | null;
}

export function clusterQueries(rows: QueryTotals[]): QueryCluster[] {
  const sorted = [...rows].sort((a, b) => b.impressions - a.impressions);
  const clusters: Array<{ seed: Set<string>; members: QueryTotals[] }> = [];
  for (const row of sorted) {
    const t = tokens(row.query);
    const home = clusters.find(
      (c) => jaccard(c.seed, t) >= UNOWNED_CLUSTER.similarityThreshold,
    );
    if (home) home.members.push(row);
    else clusters.push({ seed: t, members: [row] });
  }
  return clusters.map((c) => ({
    label: c.members[0]!.query,
    members: c.members,
    totalImpressions: c.members.reduce((s, m) => s + m.impressions, 0),
    bestPosition: c.members.reduce<number | null>(
      (best, m) => (m.position == null ? best : best == null ? m.position : Math.min(best, m.position)),
      null,
    ),
  }));
}

export function detectUnownedClusters(
  rows: QueryTotals[],
  options: { siteDomain?: string } = {},
): FindingV2[] {
  const input = options.siteDomain
    ? rows.filter((r) => !isBrandedQuery(r.query, options.siteDomain!))
    : rows;
  return clusterQueries(input)
    .filter(
      (c) =>
        c.members.length >= UNOWNED_CLUSTER.minMembers &&
        c.totalImpressions >= UNOWNED_CLUSTER.minImpressions &&
        (c.bestPosition == null || c.bestPosition > UNOWNED_CLUSTER.minBestPosition),
    )
    .map((c) => ({
      type: "unowned_cluster" as const,
      subject: c.label,
      title: `Unowned demand: "${c.label}" cluster (${c.members.length} queries, ${c.totalImpressions} impressions)`,
      explanation:
        `${c.members.length} related queries around "${c.label}" earned ${c.totalImpressions} ` +
        `impressions, but the site's best position is ` +
        `${c.bestPosition == null ? "unranked" : c.bestPosition.toFixed(1)} — no page serves this ` +
        `demand well. Sample queries: ` +
        c.members.slice(0, 5).map((m) => `"${m.query}"`).join(", ") +
        ".",
      recommendedAction:
        "Consider a dedicated page for this topic — but only if it passes the page-creation " +
        "gate (distinct intent, genuine capability, no existing owner). Otherwise strengthen " +
        "the closest existing service page to cover it properly.",
      evidence: { cluster: c },
      priority: scoreOpportunity({
        trafficPotential: pot(c.totalImpressions),
        confidence: 70, // lexical clustering, not yet intent-verified
        commercialValue: 70,
        pageRelevance: 40, // by definition nothing ranks well
        strategicFit: 70,
        implementationEase: 40, // new content required
        networkApplicability: 60,
      }),
    }))
    .sort((a, b) => b.priority.overall - a.priority.overall);
}
