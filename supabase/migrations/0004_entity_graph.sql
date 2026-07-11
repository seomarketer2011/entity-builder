-- 0004: industries, services, locations, entity graph, evidence, scoring

create table industries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, -- e.g. fire-protection
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table services (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid not null references industries(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  unique (industry_id, slug)
);

create table customer_industries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, -- e.g. care-homes
  name text not null,
  description text
);

create type location_kind as enum
  ('country', 'region', 'city', 'borough', 'district', 'service_radius');

create table locations (
  id uuid primary key default gen_random_uuid(),
  kind location_kind not null,
  name text not null,
  slug text not null,
  country_code text not null,
  parent_location_id uuid references locations(id) on delete set null,
  -- geometry geography, -- enable with PostGIS in Phase 4
  unique (country_code, kind, slug)
);

create type entity_type as enum (
  'industry_core', 'service', 'subservice_process', 'asset_component',
  'problem_defect', 'standard_regulation', 'customer_property',
  'commercial', 'location'
);

create type review_status as enum ('candidate', 'proposed', 'approved', 'rejected');

create table entities (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid references industries(id) on delete cascade, -- null = cross-industry
  canonical_name text not null,
  entity_type entity_type not null,
  description text,
  parent_entity_id uuid references entities(id) on delete set null,
  wikidata_id text,
  status review_status not null default 'candidate',
  -- embedding vector(1536), -- enable with pgvector
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (industry_id, canonical_name)
);
create index on entities (industry_id, entity_type, status);

create table entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  alias text not null,
  unique (entity_id, alias)
);
create index on entity_aliases (alias);

create type relationship_predicate as enum (
  'installs', 'inspects', 'repairs', 'contains', 'component_of', 'requires',
  'regulated_by', 'certified_by', 'available_in', 'serves', 'solves',
  'subtype_of', 'performed_on', 'produces_deliverable'
);

create table entity_relationships (
  id uuid primary key default gen_random_uuid(),
  subject_entity_id uuid not null references entities(id) on delete cascade,
  predicate relationship_predicate not null,
  object_entity_id uuid not null references entities(id) on delete cascade,
  industry_id uuid references industries(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  confidence_score numeric(5,2),
  review_status review_status not null default 'proposed',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subject_entity_id, predicate, object_entity_id, industry_id, location_id)
);

create type evidence_source_type as enum (
  'business_truth', 'serp', 'gsc', 'authoritative', 'competitor', 'first_party'
);

create table entity_sources (
  id uuid primary key default gen_random_uuid(),
  source_type evidence_source_type not null,
  name text not null,
  url text,
  authority_note text,
  created_at timestamptz not null default now()
);

create table entity_evidence (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id) on delete cascade,
  relationship_id uuid references entity_relationships(id) on delete cascade,
  source_id uuid not null references entity_sources(id) on delete cascade,
  excerpt text,
  created_at timestamptz not null default now(),
  check (entity_id is not null or relationship_id is not null)
);

-- Component scores per entity per context (site + optional page).
-- Weights and banding live in packages/scoring; docs/ENTITY_SYSTEM.md.
create table entity_scores (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  page_id uuid references pages(id) on delete cascade,
  business_truth numeric(5,2) not null,
  serp_evidence numeric(5,2) not null,
  search_evidence numeric(5,2) not null,
  authoritative_evidence numeric(5,2) not null,
  relationship_strength numeric(5,2) not null,
  intent_fit numeric(5,2) not null,
  commercial_importance numeric(5,2) not null,
  local_relevance numeric(5,2) not null,
  total numeric(5,2) not null,
  band text not null, -- required | supporting | optional | exclude
  auto_rejected boolean not null default false,
  scored_at timestamptz not null default now(),
  unique (entity_id, site_id, page_id)
);

-- Shared master graph tables (industries, entities, …) are readable by all
-- authenticated users; writes go through the service role + review workflow.
alter table entity_scores enable row level security;
create policy entity_scores_by_site on entity_scores for select
  using (exists (select 1 from sites s where s.id = site_id and is_org_member(s.organisation_id)));
