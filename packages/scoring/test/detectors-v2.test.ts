import { describe, expect, it } from "vitest";
import {
  CANNIBALISATION,
  clusterQueries,
  DECLINING_PAGE,
  detectCannibalisation,
  detectDecliningPages,
  detectUnownedClusters,
  UNOWNED_CLUSTER,
  type PageTotals,
  type QueryPageTotals,
} from "../src/detectors-v2.js";
import type { QueryTotals } from "../src/detectors.js";

function page(overrides: Partial<PageTotals>): PageTotals {
  return { page: "https://ex.com/a", clicks: 0, impressions: 100, ctr: 0, position: 10, ...overrides };
}

function qp(query: string, url: string, impressions: number, position = 10): QueryPageTotals {
  return { query, page: url, clicks: 0, impressions, ctr: 0, position };
}

function q(query: string, impressions: number, position: number | null = 40): QueryTotals {
  return { query, clicks: 0, impressions, ctr: 0, position };
}

describe("detectDecliningPages — table-driven", () => {
  const prev = [page({ page: "/p", clicks: 40 })];
  const cases: Array<{ name: string; currentClicks: number; fires: boolean }> = [
    { name: "drop to 50% fires", currentClicks: 20, fires: true },
    { name: "drop to exactly 70% does not fire", currentClicks: 28, fires: false },
    { name: "just under 70% fires", currentClicks: 27, fires: true },
    { name: "growth does not fire", currentClicks: 45, fires: false },
    { name: "page disappeared entirely fires", currentClicks: -1, fires: true },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const current = c.currentClicks >= 0 ? [page({ page: "/p", clicks: c.currentClicks })] : [];
      expect(detectDecliningPages(current, prev).length).toBe(c.fires ? 1 : 0);
    });
  }

  it("ignores pages with too few previous clicks", () => {
    const result = detectDecliningPages(
      [],
      [page({ page: "/tiny", clicks: DECLINING_PAGE.minPreviousClicks - 1 })],
    );
    expect(result).toHaveLength(0);
  });
});

describe("detectCannibalisation — table-driven", () => {
  it("two pages splitting a query fires", () => {
    const findings = detectCannibalisation([
      qp("locksmith croydon", "/a", 60, 8),
      qp("locksmith croydon", "/b", 40, 12),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain("2 pages compete");
  });

  it("dominant page with a tiny second page does not fire", () => {
    const findings = detectCannibalisation([
      qp("locksmith croydon", "/a", 90),
      qp("locksmith croydon", "/b", 10), // 10% share < 25%
    ]);
    expect(findings).toHaveLength(0);
  });

  it("respects the minimum impressions threshold", () => {
    const findings = detectCannibalisation([
      qp("rare query", "/a", CANNIBALISATION.minQueryImpressions / 2 - 1),
      qp("rare query", "/b", CANNIBALISATION.minQueryImpressions / 2 - 1),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("three-way splits are reported with all contenders", () => {
    const findings = detectCannibalisation([
      qp("upvc door lock", "/a", 40),
      qp("upvc door lock", "/b", 35),
      qp("upvc door lock", "/c", 30),
    ]);
    expect(findings[0]!.title).toContain("3 pages");
  });
});

describe("clusterQueries", () => {
  it("groups singular/plural and reordered variants", () => {
    const clusters = clusterQueries([
      q("smart lock installation", 100),
      q("smart locks installation", 50),
      q("installation of smart lock", 30),
      q("emergency locksmith", 80),
    ]);
    expect(clusters).toHaveLength(2);
    const smart = clusters.find((c) => c.label === "smart lock installation")!;
    expect(smart.members).toHaveLength(3);
    expect(smart.totalImpressions).toBe(180);
  });

  it("labels clusters by the highest-impression member", () => {
    const clusters = clusterQueries([q("small variant", 10), q("big variant", 500)]);
    // 'variant' overlap is below threshold (1/3), so separate clusters
    expect(clusters[0]!.label).toBe("big variant");
  });
});

describe("detectUnownedClusters — table-driven", () => {
  it("fires for demand with no ranking page", () => {
    const findings = detectUnownedClusters([
      q("garage door lock repair", 120, 45),
      q("garage door locks repair", 60, 50),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.explanation).toContain("180 impressions");
  });

  it("does not fire when a page already ranks well", () => {
    const findings = detectUnownedClusters([
      q("garage door lock repair", 120, 9),
      q("garage door locks repair", 60, 50),
    ]);
    expect(findings).toHaveLength(0); // best position 9 ≤ 25
  });

  it("needs at least two member queries", () => {
    expect(detectUnownedClusters([q("lone query", 500, 60)])).toHaveLength(0);
  });

  it("needs combined demand above the threshold", () => {
    const findings = detectUnownedClusters([
      q("niche thing repair", UNOWNED_CLUSTER.minImpressions / 2 - 1, 60),
      q("niche things repair", UNOWNED_CLUSTER.minImpressions / 2 - 1, 60),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("excludes branded queries", () => {
    const findings = detectUnownedClusters(
      [q("cr9 locksmith croydon", 200, 60), q("cr9 locksmiths croydon", 100, 60)],
      { siteDomain: "cr9locksmithcroydon.co.uk" },
    );
    expect(findings).toHaveLength(0);
  });
});
