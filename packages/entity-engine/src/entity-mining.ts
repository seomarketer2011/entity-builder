/**
 * Entity discovery from Search Console demand — docs/ENTITY_SYSTEM.md
 * §Discovery.
 *
 * The entities page answers "how much demand does this entity have?".
 * This module answers the reverse, which is the harder and more useful
 * question: *what demand is there that no entity covers?*
 *
 * Method (deterministic — non-negotiable rule 9; the LLM is not involved):
 *   1. Strip the location out of each query using a vocabulary derived
 *      from the operator's own sites, so "emergency locksmith croydon"
 *      and "emergency locksmith sutton" are one service, not two.
 *   2. Drop queries already covered by an entity or one of its aliases.
 *   3. Cluster what remains lexically (the same clusterQueries the
 *      unowned-cluster detector uses).
 *   4. Name each cluster from its most representative shared n-gram
 *      rather than from its top query, which is usually too specific.
 *
 * Everything produced here is a *proposal*. Nothing is written into the
 * shared entity graph and nothing is approved without a human
 * (non-negotiable rule 3), and a proposal is only ever attached to a site
 * whose business_capabilities support it (rule 1) — that check happens at
 * approval time, where the capability data lives.
 */

import { clusterQueries, isBrandedQuery, type QueryTotals } from "@entity-builder/scoring";
import { normalizeTerm, tokenSimilarity } from "./normalize.js";

export const ENTITY_MINING = {
  /** A cluster must earn this many impressions to be worth proposing. */
  minClusterImpressions: 30,
  /** …across at least this many distinct queries. */
  minQueries: 2,
  /** Similarity to an existing entity above which demand counts as covered. */
  matchThreshold: 0.6,
  /** Longest phrase considered when naming a cluster. */
  maxNameTokens: 4,
  /** Sample queries carried as evidence on each proposal. */
  maxSampleQueries: 8,
} as const;

export interface MinedQuery {
  query: string;
  clicks: number;
  impressions: number;
  position: number | null;
}

export interface KnownEntity {
  id: string;
  canonicalName: string;
  entityType: string;
  aliases: string[];
}

export interface EntityCandidate {
  suggestedName: string;
  suggestedType: string;
  /** Location split out of the queries, if they were location-qualified. */
  locationName: string | null;
  impressions: number;
  clicks: number;
  bestPosition: number | null;
  queryCount: number;
  sampleQueries: MinedQuery[];
  /** Set when this demand is already covered — shown as covered, not new. */
  matchedEntityId: string | null;
  matchedEntityName: string | null;
  /** Operator-facing sentence explaining why this was proposed. */
  rationale: string;
}

export interface MiningOptions {
  /** Used to exclude branded queries from discovery. */
  siteDomain?: string;
  /**
   * Known place names, derived from the operator's own sites (site names,
   * geographic_limit capabilities, approved location entities). Only
   * places the business actually operates in are recognised.
   */
  locationVocabulary?: string[];
  minClusterImpressions?: number;
  minQueries?: number;
  matchThreshold?: number;
}

// -- location handling ------------------------------------------------------

/**
 * Build a location vocabulary from the operator's own data. Multi-word
 * places ("milton keynes") are kept whole so they are stripped as a unit.
 */
export function buildLocationVocabulary(sources: {
  siteNames?: string[];
  capabilityValues?: string[];
  locationNames?: string[];
}): string[] {
  const out = new Set<string>();
  for (const value of [
    ...(sources.locationNames ?? []),
    ...(sources.capabilityValues ?? []),
    ...(sources.siteNames ?? []),
  ]) {
    const normalised = normalizeTerm(value);
    if (normalised.length >= 3) out.add(normalised);
  }
  return [...out].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export interface SplitQuery {
  /** The query with any recognised place name removed. */
  service: string;
  location: string | null;
}

/**
 * Split a query into its service part and its location part. The
 * vocabulary is matched longest-first so "west bromwich" wins over
 * "bromwich".
 */
export function splitLocation(query: string, vocabulary: string[]): SplitQuery {
  const normalised = normalizeTerm(query);
  for (const place of vocabulary) {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(place)}(\\s|$)`);
    if (pattern.test(normalised)) {
      const service = normalised.replace(pattern, " ").replace(/\s+/g, " ").trim();
      // A query that is *only* a place name has no service part.
      return { service, location: place };
    }
  }
  return { service: normalised, location: null };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -- naming -----------------------------------------------------------------

/**
 * Name a cluster from the longest phrase most of its members share.
 * Clusters named after their top query inherit that query's accidental
 * specifics ("locked out of my car at night"); a shared n-gram gives the
 * general thing being asked for ("locked out of car").
 */
export function bestClusterName(members: Array<{ text: string; impressions: number }>): string {
  if (members.length === 0) return "";
  const tokenised = members.map((m) => ({
    tokens: m.text.split(" ").filter(Boolean),
    impressions: m.impressions,
  }));

  interface Score {
    phrase: string;
    length: number;
    docFreq: number;
    impressions: number;
  }
  const scores = new Map<string, Score>();

  for (const member of tokenised) {
    // Count each distinct n-gram once per member, so a repeated phrase in
    // one long query cannot outrank a phrase shared across many queries.
    const seen = new Set<string>();
    for (let n = 1; n <= ENTITY_MINING.maxNameTokens; n++) {
      for (let i = 0; i + n <= member.tokens.length; i++) {
        const phrase = member.tokens.slice(i, i + n).join(" ");
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        const existing = scores.get(phrase) ?? {
          phrase,
          length: n,
          docFreq: 0,
          impressions: 0,
        };
        existing.docFreq++;
        existing.impressions += member.impressions;
        scores.set(phrase, existing);
      }
    }
  }

  const required = Math.ceil(tokenised.length / 2);
  const shared = [...scores.values()].filter((s) => s.docFreq >= required);
  const pool = shared.length > 0 ? shared : [...scores.values()];
  pool.sort(
    (a, b) =>
      b.length - a.length ||
      b.docFreq - a.docFreq ||
      b.impressions - a.impressions ||
      a.phrase.localeCompare(b.phrase),
  );

  const winner = pool[0];
  if (!winner) return members[0]!.text;
  return titleCase(winner.phrase);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// -- type inference ---------------------------------------------------------

const PROBLEM_WORDS = [
  "broken",
  "jammed",
  "stuck",
  "snapped",
  "faulty",
  "locked out",
  "lost",
  "wont",
  "not working",
  "damaged",
  "seized",
];
const COMMERCIAL_WORDS = ["cost", "price", "prices", "quote", "cheap", "near me", "emergency", "24 hour"];
const REGULATION_WORDS = ["regulation", "regulations", "standard", "certificate", "certification", "bs", "compliance"];

/**
 * Suggest an entity_type from the wording. A suggestion only — the review
 * screen lets a human change it before anything is approved.
 */
export function inferEntityType(text: string): string {
  const value = ` ${text} `;
  if (REGULATION_WORDS.some((w) => value.includes(` ${w} `))) return "standard_regulation";
  if (PROBLEM_WORDS.some((w) => value.includes(w))) return "problem_defect";
  if (COMMERCIAL_WORDS.some((w) => value.includes(w))) return "commercial";
  return "service";
}

// -- the miner --------------------------------------------------------------

/** True when this demand is already represented in the graph. */
function findMatch(
  text: string,
  entities: KnownEntity[],
  threshold: number,
): KnownEntity | null {
  let best: { entity: KnownEntity; score: number } | null = null;
  for (const entity of entities) {
    for (const term of [entity.canonicalName, ...entity.aliases]) {
      const score = tokenSimilarity(text, term);
      if (score >= threshold && (best === null || score > best.score)) {
        best = { entity, score };
      }
    }
  }
  return best?.entity ?? null;
}

/**
 * Mine entity candidates from a site's query demand.
 *
 * Returns proposals only — new entities the graph does not cover, ordered
 * by the demand behind them. Queries already covered by an entity are
 * excluded rather than re-proposed.
 */
export function mineEntityCandidates(
  queries: MinedQuery[],
  entities: KnownEntity[],
  options: MiningOptions = {},
): EntityCandidate[] {
  const minImpressions = options.minClusterImpressions ?? ENTITY_MINING.minClusterImpressions;
  const minQueries = options.minQueries ?? ENTITY_MINING.minQueries;
  const threshold = options.matchThreshold ?? ENTITY_MINING.matchThreshold;
  const vocabulary = options.locationVocabulary ?? [];

  // Branded queries describe the business, not the services it offers.
  const relevant = options.siteDomain
    ? queries.filter((q) => !isBrandedQuery(q.query, options.siteDomain!))
    : queries;

  interface Prepared {
    original: MinedQuery;
    service: string;
    location: string | null;
  }
  const prepared: Prepared[] = [];
  for (const q of relevant) {
    const { service, location } = splitLocation(q.query, vocabulary);
    // Bare location queries ("croydon") describe no service.
    if (service.length === 0) continue;
    prepared.push({ original: q, service, location });
  }

  // Uncovered demand only.
  const uncovered = prepared.filter(
    (p) => findMatch(p.service, entities, threshold) === null,
  );

  // Cluster on the location-stripped text so the same service in twelve
  // towns forms one proposal rather than twelve.
  const asTotals: QueryTotals[] = uncovered.map((p) => ({
    query: p.service,
    clicks: p.original.clicks,
    impressions: p.original.impressions,
    ctr: 0,
    position: p.original.position,
  }));
  const byService = new Map<string, Prepared[]>();
  for (const p of uncovered) {
    const list = byService.get(p.service) ?? [];
    list.push(p);
    byService.set(p.service, list);
  }

  const candidates: EntityCandidate[] = [];
  for (const cluster of clusterQueries(asTotals)) {
    // Map cluster members back to the originals behind them.
    const originals: Prepared[] = [];
    const consumed = new Map<string, number>();
    for (const member of cluster.members) {
      const pool = byService.get(member.query) ?? [];
      const used = consumed.get(member.query) ?? 0;
      const next = pool[used];
      if (next) {
        originals.push(next);
        consumed.set(member.query, used + 1);
      }
    }
    if (originals.length === 0) continue;

    const impressions = originals.reduce((s, o) => s + o.original.impressions, 0);
    const clicks = originals.reduce((s, o) => s + o.original.clicks, 0);
    const distinctQueries = new Set(originals.map((o) => o.original.query)).size;
    if (impressions < minImpressions || distinctQueries < minQueries) continue;

    const name = bestClusterName(
      originals.map((o) => ({ text: o.service, impressions: o.original.impressions })),
    );
    if (name.length === 0) continue;

    // The location most of this demand carries, if any.
    const locationTally = new Map<string, number>();
    for (const o of originals) {
      if (o.location) {
        locationTally.set(o.location, (locationTally.get(o.location) ?? 0) + o.original.impressions);
      }
    }
    const topLocation =
      [...locationTally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ??
      null;

    const bestPosition = originals.reduce<number | null>(
      (best, o) =>
        o.original.position == null
          ? best
          : best == null
            ? o.original.position
            : Math.min(best, o.original.position),
      null,
    );

    const samples = [...originals]
      .sort((a, b) => b.original.impressions - a.original.impressions)
      .slice(0, ENTITY_MINING.maxSampleQueries)
      .map((o) => o.original);

    const locationCount = locationTally.size;
    candidates.push({
      suggestedName: name,
      suggestedType: inferEntityType(name),
      locationName: topLocation?.[0] ?? null,
      impressions,
      clicks,
      bestPosition,
      queryCount: distinctQueries,
      sampleQueries: samples,
      matchedEntityId: null,
      matchedEntityName: null,
      rationale:
        `${distinctQueries} quer${distinctQueries === 1 ? "y" : "ies"} worth ${impressions} ` +
        `impressions match no entity or alias in the graph` +
        (locationCount > 0
          ? `, across ${locationCount} location${locationCount === 1 ? "" : "s"}`
          : "") +
        `. Best position ${bestPosition == null ? "unranked" : bestPosition.toFixed(1)}.`,
    });
  }

  return candidates.sort((a, b) => b.impressions - a.impressions);
}
