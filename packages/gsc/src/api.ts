/**
 * Search Console API client — property discovery + Search Analytics.
 * Paginated at 25,000 rows per request via startRow (docs/GSC_INGESTION.md).
 */

import type { FetchLike } from "./oauth.js";

const API_BASE = "https://www.googleapis.com/webmasters/v3";

export const SEARCH_ANALYTICS_ROW_LIMIT = 25_000;

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
}

export interface SearchAnalyticsRequest {
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string; // YYYY-MM-DD inclusive
  searchType?: string; // default "web"
  dimensions: string[]; // e.g. ["date","page","query","country","device"]
  rowLimit?: number;
  startRow?: number;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function apiCall<T>(
  fetchImpl: FetchLike,
  accessToken: string,
  path: string,
  init?: { method?: string; body?: string },
): Promise<T> {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: init?.body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(
      `GSC API ${path} returned ${response.status}: ${detail.slice(0, 300)}`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

export async function listProperties(
  fetchImpl: FetchLike,
  accessToken: string,
): Promise<GscProperty[]> {
  const json = await apiCall<{ siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> }>(
    fetchImpl,
    accessToken,
    "/sites",
  );
  return (json.siteEntry ?? []).map((e) => ({
    siteUrl: e.siteUrl,
    permissionLevel: e.permissionLevel,
  }));
}

export async function querySearchAnalytics(
  fetchImpl: FetchLike,
  accessToken: string,
  propertyUri: string,
  request: SearchAnalyticsRequest,
): Promise<SearchAnalyticsRow[]> {
  const json = await apiCall<{ rows?: SearchAnalyticsRow[] }>(
    fetchImpl,
    accessToken,
    `/sites/${encodeURIComponent(propertyUri)}/searchAnalytics/query`,
    {
      method: "POST",
      body: JSON.stringify({
        startDate: request.startDate,
        endDate: request.endDate,
        type: request.searchType ?? "web",
        dimensions: request.dimensions,
        rowLimit: request.rowLimit ?? SEARCH_ANALYTICS_ROW_LIMIT,
        startRow: request.startRow ?? 0,
        dataState: "final",
      }),
    },
  );
  return json.rows ?? [];
}

/** Drain every page for a window; onPage lets callers upsert incrementally. */
export async function fetchAllRows(
  fetchImpl: FetchLike,
  accessToken: string,
  propertyUri: string,
  request: Omit<SearchAnalyticsRequest, "startRow" | "rowLimit">,
  onPage: (rows: SearchAnalyticsRow[]) => Promise<void>,
): Promise<number> {
  let startRow = 0;
  let total = 0;
  for (;;) {
    const rows = await querySearchAnalytics(fetchImpl, accessToken, propertyUri, {
      ...request,
      rowLimit: SEARCH_ANALYTICS_ROW_LIMIT,
      startRow,
    });
    if (rows.length > 0) {
      await onPage(rows);
      total += rows.length;
    }
    if (rows.length < SEARCH_ANALYTICS_ROW_LIMIT) return total;
    startRow += rows.length;
  }
}
