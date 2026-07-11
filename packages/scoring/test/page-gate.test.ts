import { describe, expect, it } from "vitest";
import { evaluatePageGate, type PageProposal } from "../src/page-gate.js";

function proposal(overrides: Partial<PageProposal["tests"]> = {}, dims?: Partial<PageProposal>): PageProposal {
  return {
    variesOnService: true,
    variesOnCustomerIndustry: true,
    variesOnLocation: true,
    ...dims,
    tests: {
      distinctIntent: true,
      distinctService: true,
      distinctIndustryContext: true,
      distinctLocalContext: true,
      distinctEvidence: true,
      sufficientDemand: true,
      noExistingOwner: true,
      commercialUsefulness: true,
      ...overrides,
    },
  };
}

describe("evaluatePageGate", () => {
  it("passes a fully distinct service-industry-location page", () => {
    const result = evaluatePageGate(proposal());
    expect(result.passed).toBe(true);
    expect(result.failedTests).toEqual([]);
  });

  it("fails when another page already owns the intent", () => {
    const result = evaluatePageGate(proposal({ noExistingOwner: false }));
    expect(result.passed).toBe(false);
    expect(result.failedTests).toEqual(["noExistingOwner"]);
    expect(result.recommendation).toMatch(/Fold this content/);
  });

  it("fails a location page with no genuine local evidence", () => {
    const result = evaluatePageGate(
      proposal({ distinctLocalContext: false, distinctEvidence: false }),
    );
    expect(result.passed).toBe(false);
    expect(result.failedTests).toContain("distinctLocalContext");
    expect(result.failedTests).toContain("distinctEvidence");
  });

  it("skips dimension tests the page does not vary on", () => {
    // Pure service-location page: customer industry distinctness not required.
    const result = evaluatePageGate(
      proposal(
        { distinctIndustryContext: undefined },
        { variesOnCustomerIndustry: false },
      ),
    );
    expect(result.passed).toBe(true);
    expect(result.skippedTests).toEqual(["distinctIndustryContext"]);
  });

  it("throws if a required dimension test was never evaluated", () => {
    expect(() =>
      evaluatePageGate(proposal({ distinctLocalContext: undefined })),
    ).toThrow(/distinctLocalContext/);
  });

  it("no demand means no page, even if everything else is distinct", () => {
    const result = evaluatePageGate(proposal({ sufficientDemand: false }));
    expect(result.passed).toBe(false);
    expect(result.failedTests).toEqual(["sufficientDemand"]);
  });
});
