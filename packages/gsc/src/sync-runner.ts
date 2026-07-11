/**
 * Sync orchestration: given a job (backfill or incremental), pull every
 * window page-by-page and hand fact rows to the storage layer. All IO is
 * injected; the worker provides real implementations.
 */

import { fetchAllRows, type SearchAnalyticsRow } from "./api.js";
import type { FetchLike } from "./oauth.js";
import {
  planBackfillWindows,
  planIncrementalWindow,
  type DateWindow,
} from "./sync-plan.js";

export const SYNC_DIMENSIONS = ["date", "page", "query", "country", "device"] as const;

export interface GscFactRow {
  date: string;
  page: string;
  query: string;
  country: string;
  device: "DESKTOP" | "MOBILE" | "TABLET";
  searchType: string;
  clicks: number;
  impressions: number;
  position: number;
}

export function mapApiRow(row: SearchAnalyticsRow, searchType = "web"): GscFactRow {
  const [date, page, query, country, device] = row.keys;
  if (!date || !page || !query || !country || !device) {
    throw new Error(`unexpected key shape from GSC API: ${JSON.stringify(row.keys)}`);
  }
  const upperDevice = device.toUpperCase();
  if (upperDevice !== "DESKTOP" && upperDevice !== "MOBILE" && upperDevice !== "TABLET") {
    throw new Error(`unknown device: ${device}`);
  }
  return {
    date,
    page,
    query,
    country: country.toLowerCase(),
    device: upperDevice,
    searchType,
    clicks: row.clicks,
    impressions: row.impressions,
    position: row.position,
  };
}

export interface SyncJobSpec {
  kind: "backfill" | "incremental";
  propertyUri: string;
  today: string; // injected — keeps runs deterministic and testable
  /** incremental only: most recent date already synced */
  lastSyncedDate?: string;
}

export interface SyncDeps {
  fetchImpl: FetchLike;
  getAccessToken: () => Promise<string>;
  upsertRows: (rows: GscFactRow[]) => Promise<void>;
  /** called after each completed window — persist for resumability */
  onWindowComplete?: (window: DateWindow, rowsInWindow: number) => Promise<void>;
}

export interface SyncResult {
  windows: DateWindow[];
  totalRows: number;
  skipped: boolean;
}

export function planWindows(spec: SyncJobSpec): DateWindow[] {
  if (spec.kind === "backfill") return planBackfillWindows(spec.today);
  if (!spec.lastSyncedDate) {
    throw new Error("incremental sync requires lastSyncedDate");
  }
  const window = planIncrementalWindow(spec.today, spec.lastSyncedDate);
  return window ? [window] : [];
}

export async function runSync(spec: SyncJobSpec, deps: SyncDeps): Promise<SyncResult> {
  const windows = planWindows(spec);
  if (windows.length === 0) return { windows, totalRows: 0, skipped: true };

  const accessToken = await deps.getAccessToken();
  let totalRows = 0;

  for (const window of windows) {
    const rowsInWindow = await fetchAllRows(
      deps.fetchImpl,
      accessToken,
      spec.propertyUri,
      {
        startDate: window.dateFrom,
        endDate: window.dateTo,
        dimensions: [...SYNC_DIMENSIONS],
      },
      async (apiRows) => {
        await deps.upsertRows(apiRows.map((r) => mapApiRow(r)));
      },
    );
    totalRows += rowsInWindow;
    await deps.onWindowComplete?.(window, rowsInWindow);
  }

  return { windows, totalRows, skipped: false };
}
