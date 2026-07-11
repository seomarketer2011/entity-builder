import { describe, expect, it } from "vitest";
import type { Entity } from "@entity-builder/domain";
import { triageCandidates } from "../src/alias-candidates.js";

const doorset: Entity = {
  id: "e-doorset",
  industryId: "i-fire",
  canonicalName: "Fire-resisting doorset",
  entityType: "asset_component",
  status: "approved",
  aliases: ["fire doorset", "fire door set", "fire-rated doorset"],
};

const closer: Entity = {
  id: "e-closer",
  industryId: "i-fire",
  canonicalName: "Door closer",
  entityType: "asset_component",
  status: "approved",
  aliases: [],
};

const entities = [doorset, closer];

describe("triageCandidates", () => {
  it("matches exact normalised canonical names", () => {
    const result = triageCandidates(["Fire resisting doorset"], entities);
    expect(result.aliasCandidates).toHaveLength(1);
    expect(result.aliasCandidates[0]).toMatchObject({
      entityId: "e-doorset",
      matchKind: "exact_normalised",
    });
  });

  it("matches existing aliases", () => {
    const result = triageCandidates(["Fire Door Set"], entities);
    expect(result.aliasCandidates[0]).toMatchObject({
      entityId: "e-doorset",
      matchKind: "existing_alias",
      similarity: 1,
    });
  });

  it("proposes high-similarity terms as alias candidates for review", () => {
    const result = triageCandidates(["fire rated door sets"], entities);
    expect(result.aliasCandidates).toHaveLength(1);
    expect(result.aliasCandidates[0]!.matchKind).toBe("high_similarity");
    expect(result.aliasCandidates[0]!.entityId).toBe("e-doorset");
  });

  it("routes dissimilar terms to new-entity candidates with nearest match noted", () => {
    const result = triageCandidates(["smoke seal"], entities);
    expect(result.aliasCandidates).toHaveLength(0);
    expect(result.newEntityCandidates).toHaveLength(1);
    expect(result.newEntityCandidates[0]!.rawTerm).toBe("smoke seal");
  });

  it("dedupes terms that normalise identically", () => {
    const result = triageCandidates(
      ["fire doorset", "Fire Doorset", "fire-doorset"],
      entities,
    );
    expect(result.aliasCandidates).toHaveLength(1);
  });

  it("skips empty/stopword-only terms", () => {
    const result = triageCandidates(["", "the", "of the"], entities);
    expect(result.aliasCandidates).toHaveLength(0);
    expect(result.newEntityCandidates).toHaveLength(0);
  });
});
