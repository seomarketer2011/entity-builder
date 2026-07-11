-- 0005: intents, clusters, page manifests, opportunities

create table search_intents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  intent_kind text not null, -- transactional | commercial | informational | local
  description text
);

create table query_clusters (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  intent_id uuid references search_intents(id) on delete set null,
  label text not null,
  created_at timestamptz not null default now()
);

create table query_cluster_members (
  cluster_id uuid not null references query_clusters(id) on delete cascade,
  query text not null,
  primary key (cluster_id, query)
);

create table page_intents (
  page_id uuid not null references pages(id) on delete cascade,
  intent_id uuid not null references search_intents(id) on delete cascade,
  primary key (page_id, intent_id)
);

create type page_entity_role as enum (
  'primary', 'location', 'customer_industry', 'supporting', 'problem',
  'commercial', 'excluded'
);

create table page_entities (
  page_id uuid not null references pages(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  role page_entity_role not null,
  -- for role='excluded': which page owns this entity instead
  owned_by_page_id uuid references pages(id) on delete set null,
  primary key (page_id, entity_id)
);

create table page_manifests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  page_id uuid not null references pages(id) on delete cascade unique,
  current_version integer not null default 1,
  gate_passed boolean,
  gate_result jsonb, -- serialized PageGateResult from packages/scoring
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table page_manifest_versions (
  manifest_id uuid not null references page_manifests(id) on delete cascade,
  version integer not null,
  manifest jsonb not null, -- serialized PageManifest from packages/domain
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (manifest_id, version)
);

create table page_evidence (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  kind text not null, -- case_study | photo | qualification | testimonial | logistics
  description text not null,
  url text,
  created_at timestamptz not null default now()
);

-- Opportunities
create type opportunity_type as enum (
  'ctr_gap', 'striking_distance', 'unowned_cluster', 'cannibalisation',
  'entity_gap', 'network_rollout', 'declining_page', 'rising_query'
);

create type opportunity_status as enum
  ('open', 'accepted', 'dismissed', 'implemented', 'measured');

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,      -- null for network-level
  network_id uuid references networks(id) on delete cascade,
  page_id uuid references pages(id) on delete set null,
  cluster_id uuid references query_clusters(id) on delete set null,
  type opportunity_type not null,
  detector_version text not null,
  title text not null,
  explanation text not null,
  recommended_action text not null,
  status opportunity_status not null default 'open',
  priority numeric(5,2) not null,
  created_at timestamptz not null default now()
);
create index on opportunities (campaign_id, status, priority desc);

create table opportunity_evidence (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  kind text not null, -- gsc_rows | serp | crawl | capability | manifest
  payload jsonb not null
);

create table opportunity_scores (
  opportunity_id uuid primary key references opportunities(id) on delete cascade,
  traffic_potential numeric(5,2) not null,
  confidence numeric(5,2) not null,
  commercial_value numeric(5,2) not null,
  page_relevance numeric(5,2) not null,
  strategic_fit numeric(5,2) not null,
  implementation_ease numeric(5,2) not null,
  network_applicability numeric(5,2) not null,
  overall numeric(5,2) not null
);

create table opportunity_reviews (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  reviewer_id uuid references users(id),
  decision text not null, -- accepted | dismissed
  note text,
  created_at timestamptz not null default now()
);

create table opportunity_outcomes (
  opportunity_id uuid primary key references opportunities(id) on delete cascade,
  baseline_from date not null,
  baseline_to date not null,
  measured_from date,
  measured_to date,
  clicks_delta integer,
  impressions_delta integer,
  position_delta double precision,
  note text
);

alter table search_intents enable row level security;
alter table query_clusters enable row level security;
alter table page_manifests enable row level security;
alter table opportunities enable row level security;

create policy intents_by_org on search_intents for all using (is_org_member(organisation_id));
create policy clusters_by_org on query_clusters for all using (is_org_member(organisation_id));
create policy manifests_by_org on page_manifests for all using (is_org_member(organisation_id));
create policy opportunities_by_org on opportunities for all using (is_org_member(organisation_id));
