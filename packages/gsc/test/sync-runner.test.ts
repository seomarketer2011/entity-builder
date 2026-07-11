import { describe, expect, it } from "vitest";
import { SEARCH_ANALYTICS_ROW_LIMIT, type SearchAnalyticsRow } from "../src/api.js";
import type { FetchLike } from "../src/oauth.js";
import { mapApiRow, planWindows, runSync, type GscFactRow } from "../src/sync-runner.js";

function makeRow(i: number): SearchAnalyticsRow {
  return {
    keys: ["2026-07-01", `https://ex.com/p${i}`, `query ${i}`, "gbr", "MOBILE"],
    clicks: i,
    impressions: i * 10,
    ctr: 0.1,
    position: 3.4,
  };
}

/** fetch that returns a fixed page count for every searchAnalytics call */
function fakeApi(pages: SearchAnalyticsRow[][]): { fetch: FetchLike; requests: number } {
  const state = { requests: 0 };
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as { startRow: number };
    const pageIndex = Math.floor(body.startRow / SEARCH_ANALYTICS_ROW_LIMIT);
    state.requests++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ rows: pages[pageIndex] ?? [] }),
      text: async () => "",
    };
  };
  return {
    fetch,
    get requests() {
      return state.requests;
    },
  };
}

describe("mapApiRow", () => {
  it("maps API keys to a fact row", () => {
    expect(mapApiRow(makeRow(1))).toEqual({
      date: "2026-07-01",
      page: "https://ex.com/p1",
      query: "query 1",
      country: "gbr",
      device: "MOBILE",
      searchType: "web",
      clicks: 1,
      impressions: 10,
      position: 3.4,
    });
  });

  it("rejects malformed key shapes and unknown devices", () => {
    expect(() => mapApiRow({ ...makeRow(1), keys: ["2026-07-01"] })).toThrow(/key shape/);
    expect(() =>
      mapApiRow({ ...makeRow(1), keys: ["2026-07-01", "p", "q", "gbr", "WATCH"] }),
    ).toThrow(/unknown device/);
  });
});

describe("planWindows", () => {
  it("backfill plans ~16 monthly windows", () => {
    const windows = planWindows({
      kind: "backfill",
      propertyUri: "sc-domain:ex.com",
      today: "2026-07-11",
    });
    expect(windows.length).toBeGreaterThanOrEqual(16);
  });

  it("incremental requires lastSyncedDate", () => {
    expect(() =>
      planWindows({ kind: "incremental", propertyUri: "x", today: "2026-07-11" }),
    ).toThrow(/lastSyncedDate/);
  });
});

describe("runSync", () => {
  it("drains paginated rows and upserts each page", async () => {
    const fullPage = Array.from({ length: SEARCH_ANALYTICS_ROW_LIMIT }, (_, i) => makeRow(i));
    const lastPage = [makeRow(1), makeRow(2)];
    const api = fakeApi([fullPage, lastPage]);
    const upserted: GscFactRow[] = [];

    const result = await runSync(
      {
        kind: "incremental",
        propertyUri: "sc-domain:ex.com",
        today: "2026-07-11",
        lastSyncedDate: "2026-07-07",
      },
      {
        fetchImpl: api.fetch,
        getAccessToken: async () => "at",
        upsertRows: async (rows) => {
          upserted.push(...rows);
        },
      },
    );

    expect(result.skipped).toBe(false);
    expect(result.totalRows).toBe(SEARCH_ANALYTICS_ROW_LIMIT + 2);
    expect(upserted).toHaveLength(SEARCH_ANALYTICS_ROW_LIMIT + 2);
    expect(api.requests).toBe(2);
  });

  it("skips when incremental window is empty", async () => {
    const api = fakeApi([]);
    const result = await runSync(
      {
        kind: "incremental",
        propertyUri: "sc-domain:ex.com",
        today: "2026-07-11",
        lastSyncedDate: "2026-07-20",
      },
      {
        fetchImpl: api.fetch,
        getAccessToken: async () => "at",
        upsertRows: async () => {},
      },
    );
    expect(result.skipped).toBe(true);
    expect(api.requests).toBe(0);
  });

  it("reports window completion for resumability", async () => {
    const api = fakeApi([[makeRow(1)]]);
    const completed: string[] = [];
    await runSync(
      {
        kind: "incremental",
        propertyUri: "sc-domain:ex.com",
        today: "2026-07-11",
        lastSyncedDate: "2026-07-05",
      },
      {
        fetchImpl: api.fetch,
        getAccessToken: async () => "at",
        upsertRows: async () => {},
        onWindowComplete: async (w, n) => {
          completed.push(`${w.dateFrom}..${w.dateTo}:${n}`);
        },
      },
    );
    expect(completed).toEqual(["2026-07-03..2026-07-08:1"]);
  });
});
