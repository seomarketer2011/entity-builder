/**
 * Opportunity priority score — docs/OPPORTUNITY_RULES.md.
 * Weighted geometric mean so a near-zero component sinks the priority
 * instead of being averaged away. Components stay independently visible.
 */

export interface OpportunityComponents {
  trafficPotential: number;
  confidence: number;
  commercialValue: number;
  pageRelevance: number;
  strategicFit: number;
  implementationEase: number;
  networkApplicability: number;
}

export const OPPORTUNITY_WEIGHTS: Record<keyof OpportunityComponents, number> = {
  trafficPotential: 20,
  confidence: 20,
  commercialValue: 20,
  pageRelevance: 15,
  strategicFit: 10,
  implementationEase: 10,
  networkApplicability: 5,
};

export interface OpportunityPriorityResult {
  overall: number;
  components: OpportunityComponents;
}

export function scoreOpportunity(
  raw: OpportunityComponents,
): OpportunityPriorityResult {
  const keys = Object.keys(OPPORTUNITY_WEIGHTS) as Array<keyof OpportunityComponents>;
  const components = {} as OpportunityComponents;
  for (const key of keys) {
    const v = raw[key];
    if (!Number.isFinite(v)) throw new Error(`${key} must be finite, got ${v}`);
    components[key] = Math.min(100, Math.max(0, v));
  }

  const totalWeight = keys.reduce((sum, k) => sum + OPPORTUNITY_WEIGHTS[k], 0);
  // Floor each component at 1 so a single zero yields a very low (not NaN/0
  // -collapsed) score while still dominating the result.
  let logSum = 0;
  for (const key of keys) {
    const v = Math.max(1, components[key]);
    logSum += (OPPORTUNITY_WEIGHTS[key] / totalWeight) * Math.log(v);
  }
  const overall = Math.round(Math.exp(logSum) * 100) / 100;

  return { overall, components };
}
