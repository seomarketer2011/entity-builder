/** Mirrors supabase/migrations/0004_entity_graph.sql — keep in sync. */

export type EntityType =
  | "industry_core"
  | "service"
  | "subservice_process"
  | "asset_component"
  | "problem_defect"
  | "standard_regulation"
  | "customer_property"
  | "commercial"
  | "location";

export type ReviewStatus = "candidate" | "proposed" | "approved" | "rejected";

export type RelationshipPredicate =
  | "installs"
  | "inspects"
  | "repairs"
  | "contains"
  | "component_of"
  | "requires"
  | "regulated_by"
  | "certified_by"
  | "available_in"
  | "serves"
  | "solves"
  | "subtype_of"
  | "performed_on"
  | "produces_deliverable";

export type EvidenceSourceType =
  | "business_truth"
  | "serp"
  | "gsc"
  | "authoritative"
  | "competitor"
  | "first_party";

export interface Entity {
  id: string;
  industryId: string | null;
  canonicalName: string;
  entityType: EntityType;
  description?: string;
  parentEntityId?: string | null;
  wikidataId?: string | null;
  status: ReviewStatus;
  aliases: string[];
}

export interface EntityRelationship {
  id: string;
  subjectEntityId: string;
  predicate: RelationshipPredicate;
  objectEntityId: string;
  industryId?: string | null;
  locationId?: string | null;
  confidenceScore?: number;
  reviewStatus: ReviewStatus;
}

export interface EntityEvidence {
  sourceType: EvidenceSourceType;
  sourceName: string;
  url?: string;
  excerpt?: string;
}
