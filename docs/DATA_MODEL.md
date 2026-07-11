# Data Model

Multi-tenant from day one. Every tenant-scoped table carries
`organisation_id` (and usually `campaign_id`) and has RLS enabled.

## Tenancy & campaigns

- `organisations`, `users`, `organisation_members`
- `campaigns` — a client engagement; contains one site or a network
- `networks`, `sites`, `network_sites`

## Business truth

- `business_capabilities` — per site: services genuinely delivered / explicitly
  NOT delivered, equipment, qualifications, customer types, geographic limits,
  rejection reasons. Sourced from structured intake, not inferred.

## GSC

- `google_connections` (encrypted refresh tokens), `gsc_properties`,
  `gsc_sync_jobs`
- `gsc_daily_query_page` — the granular fact table:
  `date, site_id, page, query, country, device, search_type, clicks,
  impressions, ctr, position`
- Aggregates (`gsc_daily_page`, `gsc_daily_query`) are materialised views.

## Crawl & page inventory

- `crawls`, `pages`, `page_snapshots`, `page_headings`, `page_links`,
  `page_schema`

## Industry & entity graph

- `industries` — business industries (fire protection…) — shared masters
- `services`, `customer_industries`, `locations` (PostGIS point/area)
- `entities` — canonical name, entity_type, description, parent_entity_id,
  industry_id, wikidata_id (nullable), status
  (`candidate|proposed|approved|rejected`), embedding (pgvector)
- `entity_aliases` — alias → canonical entity
- `entity_relationships` — `subject_entity_id, predicate, object_entity_id,
  industry_id?, location_id?, confidence_score, review_status`
- `entity_sources` / `entity_evidence` — where each entity/relationship came
  from: source_type (`business_truth|serp|gsc|authoritative|competitor|
  first_party`), URL/reference, excerpt
- `entity_scores` — the eight component scores + total per entity per context

Entity types (enum): `industry_core`, `service`, `subservice_process`,
`asset_component`, `problem_defect`, `standard_regulation`,
`customer_property`, `commercial`, `location`.

Relationship predicates (enum, extensible): `installs`, `inspects`,
`repairs`, `contains`, `component_of`, `requires`, `regulated_by`,
`certified_by`, `available_in`, `serves`, `solves`, `subtype_of`,
`performed_on`, `produces_deliverable`.

## Queries, intents & page ownership

- `search_intents`, `query_clusters`, `queries`
- `page_intents` — which intent a page owns
- `page_entities` — entity assignment with role
  (`primary|location|customer_industry|supporting|problem|commercial|excluded`)
- `page_manifests`, `page_manifest_versions` — the full ownership manifest
  (see PAGE_MANIFESTS.md)
- `page_evidence` — unique proof assigned to a page (case studies, photos,
  qualifications)

## Opportunities

- `opportunities` — type, site_id, page_id?, cluster_id?, status
- `opportunity_evidence` — the underlying GSC/crawl/SERP rows
- `opportunity_scores` — each component visible (traffic potential,
  confidence, commercial value, page relevance, strategic fit,
  implementation ease, network applicability)
- `opportunity_actions`, `opportunity_reviews`, `opportunity_outcomes` —
  accepted recommendations tracked to measured results

## Conventions

- Primary keys: `uuid` default `gen_random_uuid()`.
- Timestamps: `created_at`/`updated_at` `timestamptz` default `now()`.
- Enums as Postgres enum types; extend via migration.
- Migrations are append-only: never edit a merged migration.
- Raw import tables (`raw_*`) are ingestion landing zones; verified tables
  are only written by validated promotion jobs.
