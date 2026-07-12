import { describe, expect, it } from "vitest";
import {
  CTR_GAP,
  detectCtrGap,
  detectStrikingDistance,
  expectedCtr,
  runDetectors,
  STRIKING_DISTANCE,
  type QueryTotals,
} from "../src/detectors.js";

function row(overrides: Partial<QueryTotals>): QueryTotals {
  return {
    query: "electrician fulham",
    clicks: 0,
    impressions: 100,
    ctr: 0,
    position: 10,
    ...overrides,
  };
}

describe("expectedCtr", () => {
  it("is monotonically decreasing over positions 1..10 and 0 beyond", () => {
    let prev = 1;
    for (let p = 1; p <= 10; p++) {
      const ctr = expectedCtr(p);
      expect(ctr).toBeLessThan(prev);
      prev = ctr;
    }
    expect(expectedCtr(11)).toBe(0);
  });
});

describe("detectStrikingDistance — table-driven", () => {
  const cases: Array<{ name: string; row: QueryTotals; fires: boolean }> = [
    { name: "position 4, enough impressions", row: row({ position: 4, impressions: 50 }), fires: true },
    { name: "position 20 boundary", row: row({ position: 20, impressions: 200 }), fires: true },
    { name: "position 20.5 outside", row: row({ position: 20.5, impressions: 200 }), fires: false },
    { name: "position 3 too good", row: row({ position: 3, impressions: 500 }), fires: false },
    { name: "too few impressions", row: row({ position: 8, impressions: 49 }), fires: false },
    { name: "null position", row: row({ position: null }), fires: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(detectStrikingDistance([c.row]).length).toBe(c.fires ? 1 : 0);
    });
  }

  it("nearer page one scores easier implementation", () => {
    const near = detectStrikingDistance([row({ position: 5, impressions: 100 })])[0]!;
    const far = detectStrikingDistance([
      row({ query: "other", position: 19, impressions: 100 }),
    ])[0]!;
    expect(near.priority.components.implementationEase).toBeGreaterThan(
      far.priority.components.implementationEase,
    );
  });
});

describe("detectCtrGap — table-driven", () => {
  const cases: Array<{ name: string; row: QueryTotals; fires: boolean }> = [
    {
      name: "position 3, ctr far below expected",
      row: row({ position: 3, impressions: 200, ctr: 0.01 }),
      fires: true,
    },
    {
      name: "position 3, healthy ctr",
      row: row({ position: 3, impressions: 200, ctr: 0.1 }),
      fires: false,
    },
    {
      name: "ctr exactly at the gap threshold does not fire",
      row: row({ position: 1, impressions: 500, ctr: 0.28 * CTR_GAP.gapFraction }),
      fires: false,
    },
    {
      name: "just under the threshold fires",
      row: row({ position: 1, impressions: 500, ctr: 0.28 * CTR_GAP.gapFraction - 0.001 }),
      fires: true,
    },
    {
      name: "position 11 outside top 10",
      row: row({ position: 11, impressions: 1000, ctr: 0 }),
      fires: false,
    },
    {
      name: "too few impressions",
      row: row({ position: 2, impressions: 99, ctr: 0 }),
      fires: false,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(detectCtrGap([c.row]).length).toBe(c.fires ? 1 : 0);
    });
  }

  it("reports missed clicks in the explanation", () => {
    const finding = detectCtrGap([row({ position: 1, impressions: 1000, ctr: 0.01 })])[0]!;
    expect(finding.explanation).toMatch(/270 clicks left on the table/);
  });
});

describe("runDetectors", () => {
  it("a position 4-10 query with a CTR gap fires ctr_gap, not both", () => {
    const findings = runDetectors([row({ position: 5, impressions: 300, ctr: 0.001 })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("ctr_gap");
  });

  it("sorts by priority descending", () => {
    const findings = runDetectors([
      row({ query: "small", position: 15, impressions: 60 }),
      row({ query: "big", position: 5, impressions: 5000, ctr: 0.001 }),
    ]);
    expect(findings[0]!.query).toBe("big");
    const priorities = findings.map((f) => f.priority.overall);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
  });

  it("thresholds match the documented values", () => {
    expect(STRIKING_DISTANCE).toEqual({ minPosition: 4, maxPosition: 20, minImpressions: 50 });
    expect(CTR_GAP).toEqual({ maxPosition: 10, minImpressions: 100, gapFraction: 0.5 });
  });
});
