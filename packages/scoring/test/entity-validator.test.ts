import { describe, expect, it } from "vitest";
import {
  ENTITY_SCORE_WEIGHTS,
  scoreEntity,
  type EntityEvidenceInputs,
} from "../src/entity-validator.js";

const base: EntityEvidenceInputs = {
  businessTruth: 0,
  serpEvidence: 0,
  searchEvidence: 0,
  authoritativeEvidence: 0,
  relationshipStrength: 0,
  intentFit: 0,
  commercialImportance: 0,
  localRelevance: 0,
  businessProvidesIt: true,
  relationshipAccurate: true,
};

describe("scoreEntity", () => {
  it("weights sum to 100", () => {
    const sum = Object.values(ENTITY_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("perfect evidence scores 100 and is required", () => {
    const result = scoreEntity({
      ...base,
      businessTruth: 100,
      serpEvidence: 100,
      searchEvidence: 100,
      authoritativeEvidence: 100,
      relationshipStrength: 100,
      intentFit: 100,
      commercialImportance: 100,
      localRelevance: 100,
    });
    expect(result.total).toBe(100);
    expect(result.band).toBe("required");
  });

  it("core service entity for a genuine provider lands in required band", () => {
    // e.g. "fire-resisting doorset" on a fire door installation page
    const result = scoreEntity({
      ...base,
      businessTruth: 100, // 25
      serpEvidence: 80, // 12
      searchEvidence: 70, // 10.5
      authoritativeEvidence: 90, // 13.5
      relationshipStrength: 100, // 10
      intentFit: 90, // 9
      commercialImportance: 60, // 3
      localRelevance: 40, // 2
    });
    expect(result.total).toBe(85);
    expect(result.band).toBe("required");
    expect(result.autoRejected).toBe(false);
  });

  it("weak evidence lands in exclude band", () => {
    const result = scoreEntity({ ...base, businessTruth: 50, serpEvidence: 40 });
    expect(result.total).toBe(18.5);
    expect(result.band).toBe("exclude");
  });

  it("band boundaries: 75 required, 55 supporting, 35 optional", () => {
    // businessTruth 100 (25) + serp 100 (15) + search 100 (15) + auth 100 (15)
    // + relationship 50 (5) = 75
    const seventyFive = scoreEntity({
      ...base,
      businessTruth: 100,
      serpEvidence: 100,
      searchEvidence: 100,
      authoritativeEvidence: 100,
      relationshipStrength: 50,
    });
    expect(seventyFive.total).toBe(75);
    expect(seventyFive.band).toBe("required");

    const fiftyFive = scoreEntity({
      ...base,
      businessTruth: 100,
      serpEvidence: 100,
      searchEvidence: 100,
    });
    expect(fiftyFive.total).toBe(55);
    expect(fiftyFive.band).toBe("supporting");

    const thirtyFive = scoreEntity({
      ...base,
      businessTruth: 80,
      serpEvidence: 100,
    });
    expect(thirtyFive.total).toBe(35);
    expect(thirtyFive.band).toBe("optional");
  });

  it("auto-rejects when the business does not provide it, regardless of evidence", () => {
    const result = scoreEntity({
      ...base,
      businessTruth: 100,
      serpEvidence: 100,
      searchEvidence: 100,
      authoritativeEvidence: 100,
      relationshipStrength: 100,
      intentFit: 100,
      commercialImportance: 100,
      localRelevance: 100,
      businessProvidesIt: false,
    });
    expect(result.autoRejected).toBe(true);
    expect(result.band).toBe("exclude");
    expect(result.total).toBe(0);
    expect(result.explanation).toMatch(/does not provide/);
  });

  it("auto-rejects inaccurate relationships", () => {
    const result = scoreEntity({ ...base, relationshipAccurate: false });
    expect(result.autoRejected).toBe(true);
    expect(result.explanation).toMatch(/inaccurate/);
  });

  it("clamps out-of-range component inputs", () => {
    const result = scoreEntity({ ...base, businessTruth: 250, serpEvidence: -40 });
    expect(result.components.businessTruth).toBe(100);
    expect(result.components.serpEvidence).toBe(0);
    expect(result.total).toBe(25);
  });

  it("rejects non-finite inputs", () => {
    expect(() => scoreEntity({ ...base, intentFit: Number.NaN })).toThrow(/intentFit/);
  });
});
