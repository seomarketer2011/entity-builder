/** Page ownership manifests — see docs/PAGE_MANIFESTS.md. */

export type PageEntityRole =
  | "primary"
  | "location"
  | "customer_industry"
  | "supporting"
  | "problem"
  | "commercial"
  | "excluded";

export interface ManifestEntityRef {
  entityId: string;
  canonicalName: string;
  role: PageEntityRole;
  /** For role="excluded": the page that owns this entity instead. */
  ownedByPageId?: string;
}

export interface PageManifest {
  pageId: string;
  /** Exactly one primary entity. */
  primaryEntity: ManifestEntityRef;
  locationEntity?: ManifestEntityRef;
  customerIndustryEntity?: ManifestEntityRef;
  supportingEntities: ManifestEntityRef[];
  problems: ManifestEntityRef[];
  commercialEntities: ManifestEntityRef[];
  uniqueEvidenceRequired: string[];
  excluded: ManifestEntityRef[];
}
