import { describe, expect, it } from "vitest";
import competitorsFixture from "./fixtures/competitors-domain.json" with { type: "json" };
import rankedFixture from "./fixtures/ranked-keywords.json" with { type: "json" };
import {
  createDataForSeoClient,
  LOCATION_UK,
  normaliseDomain,
  rankedKeywordsAsDemand,
  SERP_LIMITS,
  SerpApiError,
  SerpBudgetExceededError,
  type FetchLike,
} from "../src/dataforseo.js";

/** Records every request so tests can assert on what was sent. */
function stubFetch(
  body: unknown,
  init: { ok?: boolean; status?: number; text?: string } = {},
): { fetchImpl: FetchLike; calls: Array<{ url: string; payload: any; headers: any }> } {
  const calls: Array<{ url: string; payload: any; headers: any }> = [];
  const fetchImpl: FetchLike = async (url, options) => {
    calls.push({
      url,
      payload: options?.body ? JSON.parse(options.body) : null,
      headers: options?.headers,
    });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      text: async () => init.text ?? JSON.stringify(body),
      json: async () => body,
    };
  };
  return { fetchImpl, calls };
}

function client(fetchImpl: FetchLike, callBudget?: number) {
  return createDataForSeoClient({
    fetchImpl,
    credentials: { login: "user", password: "pass" },
    ...(callBudget === undefined ? {} : { callBudget }),
  });
}

describe("normaliseDomain", () => {
  const cases: Array<[string, string]> = [
    ["https://www.keytek.co.uk/", "keytek.co.uk"],
    ["WWW.Keytek.co.uk", "keytek.co.uk"],
    ["keytek.co.uk/path/here", "keytek.co.uk"],
    ["  keytek.co.uk  ", "keytek.co.uk"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      expect(normaliseDomain(input)).toBe(expected);
    });
  }
});

describe("rankedKeywords", () => {
  it("parses a real API response", async () => {
    const { fetchImpl } = stubFetch(rankedFixture);
    const result = await client(fetchImpl).rankedKeywords("keytek.co.uk");

    expect(result.length).toBeGreaterThan(0);
    const first = result[0]!;
    expect(typeof first.keyword).toBe("string");
    expect(first.searchVolume).toBeGreaterThan(0);
    expect(first.url).toContain("keytek.co.uk");
  });

  it("orders by search volume descending", async () => {
    const { fetchImpl } = stubFetch(rankedFixture);
    const result = await client(fetchImpl).rankedKeywords("keytek.co.uk");
    const volumes = result.map((r) => r.searchVolume);
    expect([...volumes].sort((a, b) => b - a)).toEqual(volumes);
  });

  it("sends UK and English defaults", async () => {
    const { fetchImpl, calls } = stubFetch(rankedFixture);
    await client(fetchImpl).rankedKeywords("keytek.co.uk");
    expect(calls[0]!.payload[0].location_code).toBe(LOCATION_UK);
    expect(calls[0]!.payload[0].language_code).toBe("en");
  });

  it("sends basic auth", async () => {
    const { fetchImpl, calls } = stubFetch(rankedFixture);
    await client(fetchImpl).rankedKeywords("keytek.co.uk");
    expect(calls[0]!.headers.authorization).toBe(`Basic ${btoa("user:pass")}`);
  });

  it("caps the requested row count at the per-call limit", async () => {
    const { fetchImpl, calls } = stubFetch(rankedFixture);
    await client(fetchImpl).rankedKeywords("keytek.co.uk", { limit: 100_000 });
    expect(calls[0]!.payload[0].limit).toBe(SERP_LIMITS.maxRowsPerCall);
  });

  it("filters by maximum rank when asked", async () => {
    const { fetchImpl } = stubFetch(rankedFixture);
    const result = await client(fetchImpl).rankedKeywords("keytek.co.uk", { maxRank: 3 });
    expect(result.every((r) => r.rank != null && r.rank <= 3)).toBe(true);
  });

  it("survives missing optional fields", async () => {
    const { fetchImpl } = stubFetch({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items: [{ keyword_data: { keyword: "x" } }] }] }],
    });
    const result = await client(fetchImpl).rankedKeywords("t.com");
    expect(result).toEqual([
      { keyword: "x", searchVolume: 0, cpc: null, competition: null, rank: null, url: null, mainIntent: null },
    ]);
  });

  it("drops rows with no keyword", async () => {
    const { fetchImpl } = stubFetch({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items: [{ keyword_data: {} }, null] }] }],
    });
    expect(await client(fetchImpl).rankedKeywords("t.com")).toEqual([]);
  });

  it("returns empty when the API sends no result block", async () => {
    const { fetchImpl } = stubFetch({ status_code: 20000, tasks: [{ status_code: 20000 }] });
    expect(await client(fetchImpl).rankedKeywords("t.com")).toEqual([]);
  });
});

describe("competitorDomains", () => {
  it("parses a real API response", async () => {
    const { fetchImpl } = stubFetch(competitorsFixture);
    const result = await client(fetchImpl).competitorDomains("keytek.co.uk");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.intersections).toBeGreaterThan(0);
  });

  it("excludes the target, which the API returns as its own top competitor", async () => {
    const { fetchImpl } = stubFetch(competitorsFixture);
    const result = await client(fetchImpl).competitorDomains("https://www.keytek.co.uk/");
    expect(result.map((r) => r.domain)).not.toContain("keytek.co.uk");
  });

  it("orders by keyword intersections descending", async () => {
    const { fetchImpl } = stubFetch(competitorsFixture);
    const result = await client(fetchImpl).competitorDomains("keytek.co.uk");
    const values = result.map((r) => r.intersections);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });
});

describe("error handling", () => {
  it("throws on an HTTP error", async () => {
    const { fetchImpl } = stubFetch(null, { ok: false, status: 401, text: "unauthorized" });
    await expect(client(fetchImpl).rankedKeywords("t.com")).rejects.toThrow(SerpApiError);
  });

  it("throws when the body carries an error code despite HTTP 200", async () => {
    // DataForSEO signals most failures this way, so the HTTP status alone
    // is not enough to trust the response.
    const { fetchImpl } = stubFetch({ status_code: 40200, status_message: "Payment Required" });
    await expect(client(fetchImpl).rankedKeywords("t.com")).rejects.toThrow(/Payment Required/);
  });

  it("throws when the task failed inside a successful envelope", async () => {
    const { fetchImpl } = stubFetch({
      status_code: 20000,
      tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
    });
    await expect(client(fetchImpl).rankedKeywords("t.com")).rejects.toThrow(/Invalid Field/);
  });

  it("surfaces the API status code on the error", async () => {
    const { fetchImpl } = stubFetch({ status_code: 40200, status_message: "Payment Required" });
    await expect(client(fetchImpl).rankedKeywords("t.com")).rejects.toMatchObject({
      statusCode: 40200,
    });
  });
});

describe("cost control", () => {
  it("refuses to exceed the call budget", async () => {
    const { fetchImpl } = stubFetch(rankedFixture);
    const c = client(fetchImpl, 2);
    await c.rankedKeywords("a.com");
    await c.rankedKeywords("b.com");
    await expect(c.rankedKeywords("c.com")).rejects.toThrow(SerpBudgetExceededError);
    expect(c.callsUsed()).toBe(2);
  });

  it("counts a failed call against the budget", async () => {
    // Otherwise a failing endpoint could be retried without limit.
    const { fetchImpl } = stubFetch(null, { ok: false, status: 500, text: "boom" });
    const c = client(fetchImpl, 1);
    await expect(c.rankedKeywords("a.com")).rejects.toThrow(SerpApiError);
    await expect(c.rankedKeywords("b.com")).rejects.toThrow(SerpBudgetExceededError);
  });

  it("accumulates the reported spend", async () => {
    const { fetchImpl } = stubFetch(rankedFixture);
    const c = client(fetchImpl);
    await c.rankedKeywords("a.com");
    await c.rankedKeywords("b.com");
    expect(c.costUsed()).toBeCloseTo((rankedFixture as { cost: number }).cost * 2, 5);
  });

  it("shares one budget across both endpoints", async () => {
    const { fetchImpl } = stubFetch(competitorsFixture);
    const c = client(fetchImpl, 1);
    await c.competitorDomains("a.com");
    await expect(c.rankedKeywords("a.com")).rejects.toThrow(SerpBudgetExceededError);
  });
});

describe("rankedKeywordsAsDemand", () => {
  it("maps search volume onto the miner's impression field", () => {
    const demand = rankedKeywordsAsDemand([
      { keyword: "car key programming", searchVolume: 880, cpc: 3, competition: 0.4, rank: 4, url: "u", mainIntent: "commercial" },
    ]);
    expect(demand).toEqual([
      { query: "car key programming", clicks: 0, impressions: 880, position: 4 },
    ]);
  });

  it("returns an empty list for no keywords", () => {
    expect(rankedKeywordsAsDemand([])).toEqual([]);
  });
});
