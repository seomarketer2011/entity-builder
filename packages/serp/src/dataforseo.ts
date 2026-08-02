/**
 * DataForSEO Labs client — competitor discovery and the keywords a domain
 * ranks for. Used to find entities a site *should* cover that its own
 * Search Console data cannot reveal, because you never get impressions for
 * topics you have no page for.
 *
 * Injected fetch, no ambient credentials, no I/O beyond the call itself,
 * so the whole thing is testable against recorded fixtures.
 *
 * Cost control matters here: this is a metered, paid API and the account
 * holds a finite balance. Every request goes through `guardedRequest`,
 * which caps rows per call and refuses to run once a per-run call budget
 * is spent. The caller decides the budget; nothing here loops unbounded.
 */

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

const API_BASE = "https://api.dataforseo.com/v3";

/** United Kingdom. DataForSEO location codes, not ISO. */
export const LOCATION_UK = 2826;

export const SERP_LIMITS = {
  /** Rows requested per call. Higher costs more per call. */
  maxRowsPerCall: 200,
  /** Calls a single discovery run may make, across all endpoints. */
  maxCallsPerRun: 12,
  /** Competitor domains examined per run. */
  maxCompetitors: 5,
} as const;

export interface DataForSeoCredentials {
  login: string;
  password: string;
}

export interface ClientOptions {
  fetchImpl: FetchLike;
  credentials: DataForSeoCredentials;
  baseUrl?: string;
  /** Shared across every call made by this client instance. */
  callBudget?: number;
}

export interface CompetitorDomain {
  domain: string;
  /** Keywords this domain and the target both rank for. */
  intersections: number;
  avgPosition: number | null;
  /** Estimated traffic value of the domain's organic keywords. */
  etv: number | null;
}

export interface RankedKeyword {
  keyword: string;
  searchVolume: number;
  cpc: number | null;
  competition: number | null;
  /** Position of the ranking URL in the organic results. */
  rank: number | null;
  url: string | null;
  mainIntent: string | null;
}

export class SerpBudgetExceededError extends Error {
  constructor(budget: number) {
    super(`DataForSEO call budget of ${budget} exhausted for this run`);
    this.name = "SerpBudgetExceededError";
  }
}

export class SerpApiError extends Error {
  readonly status: number;
  readonly statusCode: number | null;
  constructor(message: string, status: number, statusCode: number | null) {
    super(message);
    this.name = "SerpApiError";
    this.status = status;
    this.statusCode = statusCode;
  }
}

// -- response shapes (only the fields used; the payload is much larger) -----

interface EnvelopeTask {
  status_code?: number;
  status_message?: string;
  result?: Array<{ items?: unknown[] | null } | null> | null;
}
interface Envelope {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: EnvelopeTask[] | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface DataForSeoClient {
  /** Domains competing with `target` for the same keywords. */
  competitorDomains(
    target: string,
    options?: { locationCode?: number; languageCode?: string; limit?: number },
  ): Promise<CompetitorDomain[]>;
  /** Keywords `target` currently ranks for, highest volume first. */
  rankedKeywords(
    target: string,
    options?: {
      locationCode?: number;
      languageCode?: string;
      limit?: number;
      /** Only keywords ranking at or above this position. */
      maxRank?: number;
    },
  ): Promise<RankedKeyword[]>;
  /** Calls made so far by this client instance. */
  callsUsed(): number;
  /** Total API cost reported by DataForSEO for this instance, in USD. */
  costUsed(): number;
}

export function createDataForSeoClient(options: ClientOptions): DataForSeoClient {
  const baseUrl = options.baseUrl ?? API_BASE;
  const budget = options.callBudget ?? SERP_LIMITS.maxCallsPerRun;
  let calls = 0;
  let cost = 0;

  // btoa is available in workers and modern Node; Buffer is not, on
  // Cloudflare. Basic auth per DataForSEO's documented scheme.
  const authorization = `Basic ${btoa(`${options.credentials.login}:${options.credentials.password}`)}`;

  async function guardedRequest(path: string, payload: unknown): Promise<unknown[]> {
    if (calls >= budget) throw new SerpBudgetExceededError(budget);
    calls++;

    const response = await options.fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify([payload]),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new SerpApiError(
        `DataForSEO ${path} returned HTTP ${response.status}: ${detail.slice(0, 300)}`,
        response.status,
        null,
      );
    }

    const envelope = (await response.json()) as Envelope;
    // DataForSEO returns HTTP 200 with an error status_code in the body,
    // so the HTTP check above is not sufficient on its own.
    if (envelope.status_code !== 20000) {
      throw new SerpApiError(
        `DataForSEO ${path} failed: ${envelope.status_message ?? "unknown error"}`,
        response.status,
        envelope.status_code ?? null,
      );
    }
    cost += envelope.cost ?? 0;

    const task = envelope.tasks?.[0];
    if (task && task.status_code !== undefined && task.status_code !== 20000) {
      throw new SerpApiError(
        `DataForSEO ${path} task failed: ${task.status_message ?? "unknown error"}`,
        response.status,
        task.status_code,
      );
    }
    return task?.result?.[0]?.items ?? [];
  }

  function clampLimit(limit: number | undefined): number {
    const requested = limit ?? SERP_LIMITS.maxRowsPerCall;
    return Math.max(1, Math.min(requested, SERP_LIMITS.maxRowsPerCall));
  }

  return {
    async competitorDomains(target, opts = {}) {
      const items = await guardedRequest("/dataforseo_labs/google/competitors_domain/live", {
        target,
        location_code: opts.locationCode ?? LOCATION_UK,
        language_code: opts.languageCode ?? "en",
        limit: clampLimit(opts.limit),
      });

      return items
        .map((raw) => {
          const item = asRecord(raw);
          const organic = asRecord(asRecord(item.metrics).organic);
          return {
            domain: str(item.domain) ?? "",
            intersections: num(item.intersections) ?? 0,
            avgPosition: num(item.avg_position),
            etv: num(organic.etv),
          };
        })
        .filter((c) => c.domain.length > 0)
        // The target itself is always returned as its own top "competitor".
        .filter((c) => normaliseDomain(c.domain) !== normaliseDomain(target))
        .sort((a, b) => b.intersections - a.intersections);
    },

    async rankedKeywords(target, opts = {}) {
      const items = await guardedRequest("/dataforseo_labs/google/ranked_keywords/live", {
        target,
        location_code: opts.locationCode ?? LOCATION_UK,
        language_code: opts.languageCode ?? "en",
        limit: clampLimit(opts.limit),
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
      });

      const maxRank = opts.maxRank;
      return items
        .map((raw) => {
          const item = asRecord(raw);
          const keywordData = asRecord(item.keyword_data);
          const info = asRecord(keywordData.keyword_info);
          const serpItem = asRecord(asRecord(item.ranked_serp_element).serp_item);
          const intent = asRecord(keywordData.search_intent_info);
          return {
            keyword: str(keywordData.keyword) ?? "",
            searchVolume: num(info.search_volume) ?? 0,
            cpc: num(info.cpc),
            competition: num(info.competition),
            rank: num(serpItem.rank_group),
            url: str(serpItem.url),
            mainIntent: str(intent.main_intent),
          };
        })
        .filter((k) => k.keyword.length > 0)
        .filter((k) => maxRank == null || (k.rank != null && k.rank <= maxRank))
        .sort((a, b) => b.searchVolume - a.searchVolume);
    },

    callsUsed: () => calls,
    costUsed: () => cost,
  };
}

/** Strip scheme, www and trailing slash so domains compare sensibly. */
export function normaliseDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/**
 * Convert competitor keywords into the demand shape the entity miner
 * consumes, so SERP-sourced and GSC-sourced discovery run through exactly
 * the same clustering, location-splitting and naming rules.
 *
 * Search volume stands in for impressions: it is the closest available
 * measure of how much demand sits behind the keyword. Position is the
 * competitor's, not ours — we do not rank for these at all, which is the
 * entire point of looking at them.
 */
export function rankedKeywordsAsDemand(
  keywords: RankedKeyword[],
): Array<{ query: string; clicks: number; impressions: number; position: number | null }> {
  return keywords.map((k) => ({
    query: k.keyword,
    clicks: 0,
    impressions: k.searchVolume,
    position: k.rank,
  }));
}
