export type OpportunityType =
  | "ctr_gap"
  | "striking_distance"
  | "unowned_cluster"
  | "cannibalisation"
  | "entity_gap"
  | "network_rollout"
  | "declining_page"
  | "rising_query";

export type OpportunityStatus =
  | "open"
  | "accepted"
  | "dismissed"
  | "implemented"
  | "measured";

/** One granular GSC fact row — mirrors gsc_daily_query_page. */
export interface GscRow {
  date: string; // ISO date
  page: string;
  query: string;
  country: string;
  device: "DESKTOP" | "MOBILE" | "TABLET";
  clicks: number;
  impressions: number;
  position: number;
}
