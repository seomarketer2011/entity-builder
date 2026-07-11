/**
 * Entity validation scoring — docs/ENTITY_SYSTEM.md.
 * Weights and bands here are the canonical implementation; the doc table
 * must match. Pure function: evidence in, score + band + explanation out.
 */

export interface EntityEvidenceInputs {
  /** Each component rated 0–100 by its upstream evaluator. */
  businessTruth: number;
  serpEvidence: number;
  searchEvidence: number;
  authoritativeEvidence: number;
  relationshipStrength: number;
  intentFit: number;
  commercialImportance: number;
  localRelevance: number;
  /** Hard-rejection flags — override any score. */
  businessProvidesIt: boolean;
  relationshipAccurate: boolean;
}

export const ENTITY_SCORE_WEIGHTS = {
  businessTruth: 25,
  serpEvidence: 15,
  searchEvidence: 15,
  authoritativeEvidence: 15,
  relationshipStrength: 10,
  intentFit: 10,
  commercialImportance: 5,
  localRelevance: 5,
} as const;

export type EntityBand = "required" | "supporting" | "optional" | "exclude";

export const ENTITY_BANDS: ReadonlyArray<{ min: number; band: EntityBand }> = [
  { min: 75, band: "required" },
  { min: 55, band: "supporting" },
  { min: 35, band: "optional" },
  { min: 0, band: "exclude" },
];

export interface EntityScoreResult {
  total: number;
  band: EntityBand;
  autoRejected: boolean;
  components: Record<keyof typeof ENTITY_SCORE_WEIGHTS, number>;
  explanation: string;
}

function clamp(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite, got ${value}`);
  return Math.min(100, Math.max(0, value));
}

export function scoreEntity(inputs: EntityEvidenceInputs): EntityScoreResult {
  const components = {
    businessTruth: clamp(inputs.businessTruth, "businessTruth"),
    serpEvidence: clamp(inputs.serpEvidence, "serpEvidence"),
    searchEvidence: clamp(inputs.searchEvidence, "searchEvidence"),
    authoritativeEvidence: clamp(inputs.authoritativeEvidence, "authoritativeEvidence"),
    relationshipStrength: clamp(inputs.relationshipStrength, "relationshipStrength"),
    intentFit: clamp(inputs.intentFit, "intentFit"),
    commercialImportance: clamp(inputs.commercialImportance, "commercialImportance"),
    localRelevance: clamp(inputs.localRelevance, "localRelevance"),
  };

  if (!inputs.businessProvidesIt || !inputs.relationshipAccurate) {
    const reason = !inputs.businessProvidesIt
      ? "the business does not provide or encounter this"
      : "the claimed relationship is inaccurate";
    return {
      total: 0,
      band: "exclude",
      autoRejected: true,
      components,
      explanation: `Automatically rejected: ${reason}.`,
    };
  }

  let total = 0;
  for (const key of Object.keys(ENTITY_SCORE_WEIGHTS) as Array<
    keyof typeof ENTITY_SCORE_WEIGHTS
  >) {
    total += (components[key] / 100) * ENTITY_SCORE_WEIGHTS[key];
  }
  total = Math.round(total * 100) / 100;

  const band = ENTITY_BANDS.find((b) => total >= b.min)!.band;

  const strongest = (Object.entries(components) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k)
    .join(", ");

  return {
    total,
    band,
    autoRejected: false,
    components,
    explanation: `Score ${total}/100 (${band}). Strongest evidence: ${strongest}.`,
  };
}
