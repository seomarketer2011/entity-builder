import { describe, expect, it } from "vitest";
import type { FetchLike, GscFactRow } from "@entity-builder/gsc";
import { processJob, type JobDeps } from "../src/process-job.ts";

/** Fake Google: token endpoint + searchAnalytics with one small page. */
function fakeGoogle(): { fetch: FetchLike; tokenCalls: string[] } {
  const tokenCalls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      tokenCalls.push(init?.body ?? "");
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "at", expires_in: 3599 }),
        text: async () => "",
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        rows: [
          {
            keys: ["2026-07-06", "https://ex.com/", "fire doors", "gbr", "DESKTOP"],
            clicks: 5,
            impressions: 100,
            ctr: 0.05,
            position: 4.2,
          },
        ],
      }),
      text: async () => "",
    };
  };
  return { fetch, tokenCalls };
}

function makeDeps(fetch: FetchLike, written: GscFactRow[]): JobDeps {
  return {
    fetchImpl: fetch,
    oauth: { clientId: "id", clientSecret: "secret" },
    getRefreshToken: async () => "rt",
    getPropertyUri: async () => ({ propertyUri: "sc-domain:ex.com", siteId: "site-1" }),
    getLastSyncedDate: async () => "2026-07-05",
    writeRows: async (_p, _s, rows) => {
      written.push(...rows);
    },
  };
}

describe("processJob", () => {
  it("refreshes the access token and writes mapped rows", async () => {
    const google = fakeGoogle();
    const written: GscFactRow[] = [];
    const result = await processJob(
      { jobId: "j1", kind: "incremental", propertyId: "p1", today: "2026-07-11" },
      makeDeps(google.fetch, written),
    );
    expect(google.tokenCalls).toHaveLength(1);
    expect(google.tokenCalls[0]).toContain("grant_type=refresh_token");
    expect(result.totalRows).toBe(1);
    expect(written[0]).toMatchObject({ query: "fire doors", device: "DESKTOP" });
  });

  it("refuses incremental sync with no prior data", async () => {
    const google = fakeGoogle();
    const deps = { ...makeDeps(google.fetch, []), getLastSyncedDate: async () => null };
    await expect(
      processJob(
        { jobId: "j1", kind: "incremental", propertyId: "p1", today: "2026-07-11" },
        deps,
      ),
    ).rejects.toThrow(/backfill first/);
  });
});
