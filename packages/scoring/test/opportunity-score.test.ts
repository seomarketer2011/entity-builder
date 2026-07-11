import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_WEIGHTS,
  scoreOpportunity,
  type OpportunityComponents,
} from "../src/opportunity-score.js";

const strong: OpportunityComponents = {
  trafficPotential: 72,
  confidence: 86,
  commercialValue: 90,
  pageRelevance: 81,
  strategicFit: 100,
  implementationEase: 70,
  networkApplicability: 88,
};

describe("scoreOpportunity", () => {
  it("weights sum to 100", () => {
    expect(Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("uniform components return that value", () => {
    const flat = scoreOpportunity({
      trafficPotential: 60,
      confidence: 60,
      commercialValue: 60,
      pageRelevance: 60,
      strategicFit: 60,
      implementationEase: 60,
      networkApplicability: 60,
    });
    expect(flat.overall).toBeCloseTo(60, 5);
  });

  it("scores a strong opportunity high", () => {
    const result = scoreOpportunity(strong);
    expect(result.overall).toBeGreaterThan(80);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it("a near-zero component sinks the score (geometric, not averaged away)", () => {
    const noFit = scoreOpportunity({ ...strong, strategicFit: 1 });
    const arithmeticWould =
      (72 * 20 + 86 * 20 + 90 * 20 + 81 * 15 + 1 * 10 + 70 * 10 + 88 * 5) / 100;
    expect(noFit.overall).toBeLessThan(arithmeticWould);
    expect(noFit.overall).toBeLessThan(55);
  });

  it("zero components are floored to 1, never NaN or hard zero collapse", () => {
    const result = scoreOpportunity({ ...strong, strategicFit: 0 });
    expect(Number.isFinite(result.overall)).toBe(true);
    expect(result.overall).toBeGreaterThan(0);
  });

  it("clamps out-of-range values", () => {
    const result = scoreOpportunity({ ...strong, trafficPotential: 500 });
    expect(result.components.trafficPotential).toBe(100);
  });

  it("rejects non-finite inputs", () => {
    expect(() =>
      scoreOpportunity({ ...strong, confidence: Number.POSITIVE_INFINITY }),
    ).toThrow(/confidence/);
  });
});
