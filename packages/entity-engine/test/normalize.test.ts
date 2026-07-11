import { describe, expect, it } from "vitest";
import { normalizeTerm, tokenSimilarity } from "../src/normalize.js";

describe("normalizeTerm", () => {
  it("lowercases, strips hyphens and punctuation, drops stopwords", () => {
    expect(normalizeTerm("Fire-Rated Doorset")).toBe("fire rated doorset");
    expect(normalizeTerm("installation of fire doors")).toBe("installation fire doors");
    expect(normalizeTerm("FD30 doorset!")).toBe("fd30 doorset");
  });

  it("collapses whitespace", () => {
    expect(normalizeTerm("  fire   door  ")).toBe("fire door");
  });
});

describe("tokenSimilarity", () => {
  it("treats singular/plural variants as identical", () => {
    expect(tokenSimilarity("fire door", "fire doors")).toBe(1);
  });

  it("scores known alias pairs above the merge threshold", () => {
    expect(tokenSimilarity("fire door set", "fire doorset")).toBeGreaterThan(0.3);
    expect(
      tokenSimilarity("fire-rated door installation", "fire rated door installation"),
    ).toBe(1);
  });

  it("scores unrelated terms low", () => {
    expect(tokenSimilarity("fire door", "emergency lighting")).toBe(0);
  });

  it("handles empty input", () => {
    expect(tokenSimilarity("", "fire door")).toBe(0);
  });
});
