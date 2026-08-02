import { describe, expect, it } from "vitest";
import {
  buildObservations,
  classifyConflict,
  CONFLICT_LIFECYCLE,
  isOpenStatus,
  isTrackable,
  type ConflictBaseline,
  type ConflictObservation,
  type QueryConflictStatus,
} from "../src/conflict-lifecycle.js";
import type { QueryPageTotals } from "../src/detectors-v2.js";

function qp(query: string, url: string, impressions: number, clicks = 0, position = 10): QueryPageTotals {
  return { query, page: url, clicks, impressions, ctr: 0, position };
}

/** Build an observation directly, for classification tests. */
function obs(overrides: Partial<ConflictObservation> = {}): ConflictObservation {
  return {
    query: "emergency locksmith croydon",
    totalClicks: 10,
    totalImpressions: 1000,
    ownerPage: "/emergency-locksmith",
    ownerImpressions: 600,
    ownerShare: 0.6,
    contenderCount: 2,
    urlCount: 2,
    bestPosition: 4,
    contenders: [],
    ...overrides,
  };
}

function baseline(overrides: Partial<ConflictBaseline> = {}): ConflictBaseline {
  return {
    status: "ongoing",
    baselineImpressions: 1000,
    baselineOwnerShare: 0.6,
    baselineContenderCount: 2,
    peakContenderCount: 2,
    ...overrides,
  };
}

describe("buildObservations", () => {
  it("picks the highest-impression page as owner and computes share", () => {
    const [o] = buildObservations([
      qp("q", "/a", 600, 30),
      qp("q", "/b", 400, 10),
    ]);
    expect(o!.ownerPage).toBe("/a");
    expect(o!.ownerShare).toBeCloseTo(0.6);
    expect(o!.totalImpressions).toBe(1000);
    expect(o!.totalClicks).toBe(40);
    expect(o!.contenderCount).toBe(2);
  });

  it("excludes long-tail URLs below the contender share from the count", () => {
    const [o] = buildObservations([
      qp("q", "/a", 800),
      qp("q", "/b", 100),
      qp("q", "/c", 100),
    ]);
    expect(o!.urlCount).toBe(3);
    expect(o!.contenderCount).toBe(1);
    expect(o!.contenders).toHaveLength(1);
  });

  it("counts a page at exactly the share threshold as a contender", () => {
    const [o] = buildObservations([qp("q", "/a", 750), qp("q", "/b", 250)]);
    expect(o!.contenders.map((c) => c.page)).toEqual(["/a", "/b"]);
  });

  it("takes the best (lowest) position across pages", () => {
    const [o] = buildObservations([
      qp("q", "/a", 600, 0, 8),
      qp("q", "/b", 400, 0, 3),
    ]);
    expect(o!.bestPosition).toBe(3);
  });

  it("breaks impression ties deterministically by page", () => {
    const [o] = buildObservations([qp("q", "/z", 500), qp("q", "/a", 500)]);
    expect(o!.ownerPage).toBe("/a");
  });

  it("groups multiple queries independently, ordered by impressions", () => {
    const result = buildObservations([
      qp("small", "/a", 10),
      qp("big", "/a", 900),
      qp("big", "/b", 100),
    ]);
    expect(result.map((r) => r.query)).toEqual(["big", "small"]);
  });
});

describe("isTrackable", () => {
  const cases: Array<{ name: string; impressions: number; contenders: number; tracked: boolean }> = [
    { name: "contested and above the noise floor", impressions: 100, contenders: 2, tracked: true },
    { name: "exactly at the impression floor", impressions: CONFLICT_LIFECYCLE.minQueryImpressions, contenders: 2, tracked: true },
    { name: "below the impression floor", impressions: 49, contenders: 2, tracked: false },
    { name: "single owner is not a conflict", impressions: 5000, contenders: 1, tracked: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(
        isTrackable(obs({ totalImpressions: c.impressions, contenderCount: c.contenders })),
      ).toBe(c.tracked);
    });
  }
});

describe("classifyConflict — table-driven", () => {
  interface Case {
    name: string;
    observation: Partial<ConflictObservation>;
    baseline: Partial<ConflictBaseline> | null;
    expected: QueryConflictStatus;
  }

  const cases: Case[] = [
    {
      name: "first sighting is new",
      observation: {},
      baseline: null,
      expected: "new",
    },
    {
      name: "owner above 75% with demand held is resolved",
      observation: { ownerShare: 0.8, contenderCount: 1, totalImpressions: 1000 },
      baseline: {},
      expected: "resolved",
    },
    {
      // The threshold must be EXCEEDED — at exactly 75% a second page can
      // still hold the full 25% contender share, so this is not resolved.
      name: "owner at exactly 75% is improving, never resolved",
      observation: { ownerShare: 0.75, contenderCount: 2, totalImpressions: 1000 },
      baseline: {},
      expected: "improving",
    },
    {
      name: "owner steady at exactly 75% with no baseline gain is ongoing",
      observation: { ownerShare: 0.75, contenderCount: 2, totalImpressions: 1000 },
      baseline: { baselineOwnerShare: 0.75 },
      expected: "ongoing",
    },
    {
      name: "a hair above 75% with demand held is resolved",
      observation: { ownerShare: 0.7501, contenderCount: 1, totalImpressions: 1000 },
      baseline: { baselineOwnerShare: 0.75 },
      expected: "resolved",
    },
    {
      name: "owner dominant but demand collapsed is collapsed, not resolved",
      observation: { ownerShare: 0.9, contenderCount: 1, totalImpressions: 500 },
      baseline: {},
      expected: "collapsed",
    },
    {
      name: "demand at exactly the retention floor still counts as resolved",
      observation: { ownerShare: 0.9, contenderCount: 1, totalImpressions: 850 },
      baseline: {},
      expected: "resolved",
    },
    {
      name: "demand one impression under the floor is collapsed",
      observation: { ownerShare: 0.9, contenderCount: 1, totalImpressions: 849 },
      baseline: {},
      expected: "collapsed",
    },
    {
      name: "contention gone but ownership not consolidated is improving",
      observation: { ownerShare: 0.6, contenderCount: 1, totalImpressions: 1000 },
      baseline: {},
      expected: "improving",
    },
    {
      name: "contention gone because impressions died is collapsed",
      observation: { ownerShare: 0.6, contenderCount: 1, totalImpressions: 200 },
      baseline: {},
      expected: "collapsed",
    },
    {
      name: "fewer contenders while still contested is improving",
      observation: { ownerShare: 0.65, contenderCount: 2, totalImpressions: 1000 },
      baseline: { baselineContenderCount: 3 },
      expected: "improving",
    },
    {
      name: "owner share up 10 points is improving",
      observation: { ownerShare: 0.7, contenderCount: 2, totalImpressions: 1000 },
      baseline: { baselineOwnerShare: 0.6 },
      expected: "improving",
    },
    {
      name: "owner share up only 9 points is still ongoing",
      observation: { ownerShare: 0.69, contenderCount: 2, totalImpressions: 1000 },
      baseline: { baselineOwnerShare: 0.6 },
      expected: "ongoing",
    },
    {
      name: "no material change is ongoing",
      observation: { ownerShare: 0.61, contenderCount: 2, totalImpressions: 1000 },
      baseline: {},
      expected: "ongoing",
    },
    {
      name: "improvement while demand is falling does not count as improving",
      observation: { ownerShare: 0.72, contenderCount: 2, totalImpressions: 400 },
      baseline: { baselineOwnerShare: 0.6 },
      expected: "ongoing",
    },
    {
      name: "a resolved conflict that is contested again is regressed",
      observation: { ownerShare: 0.5, contenderCount: 2, totalImpressions: 1000 },
      baseline: { status: "resolved" },
      expected: "regressed",
    },
    {
      name: "a resolved conflict that stays resolved is still resolved",
      observation: { ownerShare: 0.9, contenderCount: 1, totalImpressions: 1000 },
      baseline: { status: "resolved" },
      expected: "resolved",
    },
    {
      name: "a regressed conflict that gets fixed becomes resolved",
      observation: { ownerShare: 0.85, contenderCount: 1, totalImpressions: 1000 },
      baseline: { status: "regressed" },
      expected: "resolved",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = classifyConflict(
        obs(c.observation),
        c.baseline === null ? null : baseline(c.baseline),
      );
      expect(result.status).toBe(c.expected);
      expect(result.reason.length).toBeGreaterThan(0);
    });
  }

  it("reports the share delta against the baseline", () => {
    const result = classifyConflict(
      obs({ ownerShare: 0.75, contenderCount: 2 }),
      baseline({ baselineOwnerShare: 0.5 }),
    );
    expect(result.shareDelta).toBeCloseTo(0.25);
  });

  it("has no share delta on first sighting", () => {
    expect(classifyConflict(obs(), null).shareDelta).toBeNull();
  });

  it("explains a collapse in terms the operator can act on", () => {
    const result = classifyConflict(
      obs({ ownerShare: 0.9, contenderCount: 1, totalImpressions: 100 }),
      baseline(),
    );
    expect(result.status).toBe("collapsed");
    expect(result.demandRetained).toBe(false);
    expect(result.reason).toContain("not a fix");
  });
});

describe("isOpenStatus", () => {
  const cases: Array<[QueryConflictStatus, boolean]> = [
    ["new", true],
    ["ongoing", true],
    ["improving", true],
    ["regressed", true],
    ["collapsed", true],
    ["resolved", false],
  ];
  for (const [status, open] of cases) {
    it(`${status} is ${open ? "open" : "closed"}`, () => {
      expect(isOpenStatus(status)).toBe(open);
    });
  }
});
