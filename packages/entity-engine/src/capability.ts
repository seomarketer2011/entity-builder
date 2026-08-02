/**
 * Business-capability assessment — non-negotiable rule 1.
 *
 * A site only ever gets entities its `business_capabilities` records say it
 * genuinely provides. Shared between discovery (which stores the verdict as
 * a hint for the reviewer) and approval (which re-derives it from scratch
 * and enforces it).
 *
 * The stored flag is a *hint*, never the authority: capabilities change,
 * and the reviewer can rename a candidate before approving it. Approval
 * therefore re-assesses the final name against the site's current records.
 */

export interface CapabilityRecord {
  kind: string;
  value: string;
}

export interface CapabilityVerdict {
  /** true = declared provided, false = declared NOT provided, null = unknown. */
  supported: boolean | null;
  note: string;
}

/** Kinds that count as evidence the business does offer something. */
const PROVIDES_KINDS = new Set(["service_provided", "common_job"]);
/** A hard no. Nothing matching one of these may be approved. */
const EXCLUDES_KIND = "service_not_provided";

function matches(name: string, value: string): boolean {
  const a = name.trim().toLowerCase();
  const b = value.trim().toLowerCase();
  if (a.length === 0 || b.length === 0) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Assess an entity name against a site's capability records.
 *
 * Exclusions are checked first and win outright: if a business has said it
 * does not do something, no amount of provided-records makes it true.
 */
export function assessCapability(
  entityName: string,
  capabilities: CapabilityRecord[],
): CapabilityVerdict {
  const excluded = capabilities.find(
    (c) => c.kind === EXCLUDES_KIND && matches(entityName, c.value),
  );
  if (excluded) {
    return {
      supported: false,
      note: `Declared NOT provided: "${excluded.value}". Cannot be approved for this site.`,
    };
  }

  const provided = capabilities.find(
    (c) => PROVIDES_KINDS.has(c.kind) && matches(entityName, c.value),
  );
  if (provided) {
    return { supported: true, note: `Matches declared capability "${provided.value}".` };
  }

  return {
    supported: null,
    note:
      capabilities.length === 0
        ? "No business capabilities recorded for this site — capability cannot be verified."
        : "No capability record matches. Confirm the business genuinely offers this before approving.",
  };
}
