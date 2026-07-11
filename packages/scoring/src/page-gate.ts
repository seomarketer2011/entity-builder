/**
 * Page-creation gate — docs/PAGE_MANIFESTS.md.
 * A proposed page becomes indexable only when every applicable hard test
 * passes. Distinctness tests apply only to dimensions the page varies on.
 */

export interface PageProposal {
  /** Which dimensions this page varies on vs its parent hub. */
  variesOnService: boolean;
  variesOnCustomerIndustry: boolean;
  variesOnLocation: boolean;
  tests: {
    distinctIntent: boolean;
    distinctService?: boolean;
    distinctIndustryContext?: boolean;
    distinctLocalContext?: boolean;
    distinctEvidence: boolean;
    sufficientDemand: boolean;
    noExistingOwner: boolean;
    commercialUsefulness: boolean;
  };
}

export interface PageGateResult {
  passed: boolean;
  failedTests: string[];
  skippedTests: string[];
  recommendation: string;
}

export function evaluatePageGate(proposal: PageProposal): PageGateResult {
  const failed: string[] = [];
  const skipped: string[] = [];
  const t = proposal.tests;

  const always: Array<[string, boolean]> = [
    ["distinctIntent", t.distinctIntent],
    ["distinctEvidence", t.distinctEvidence],
    ["sufficientDemand", t.sufficientDemand],
    ["noExistingOwner", t.noExistingOwner],
    ["commercialUsefulness", t.commercialUsefulness],
  ];
  for (const [name, pass] of always) if (!pass) failed.push(name);

  const dimensional: Array<[string, boolean, boolean | undefined]> = [
    ["distinctService", proposal.variesOnService, t.distinctService],
    ["distinctIndustryContext", proposal.variesOnCustomerIndustry, t.distinctIndustryContext],
    ["distinctLocalContext", proposal.variesOnLocation, t.distinctLocalContext],
  ];
  for (const [name, applies, pass] of dimensional) {
    if (!applies) {
      skipped.push(name);
      continue;
    }
    if (pass === undefined) {
      throw new Error(`${name} must be evaluated: the page varies on that dimension`);
    }
    if (!pass) failed.push(name);
  }

  const passed = failed.length === 0;
  return {
    passed,
    failedTests: failed,
    skippedTests: skipped,
    recommendation: passed
      ? "Create the page with a full manifest."
      : `Do not create a new URL (failed: ${failed.join(", ")}). Fold this content into the strongest existing hub or service page.`,
  };
}
