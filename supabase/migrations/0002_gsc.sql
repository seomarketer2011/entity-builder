-- 0002: Google Search Console connections, properties, sync jobs, fact table

create table google_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  google_account_email text not null,
  -- AES-256-GCM ciphertext; decrypted only in the worker (see docs/SECURITY.md)
  encrypted_refresh_token bytea not null,
  token_nonce bytea not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table gsc_properties (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  connection_id uuid not null references google_connections(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  property_uri text not null, -- e.g. sc-domain:example.com
  permission_level text,
  created_at timestamptz not null default now(),
  unique (connection_id, property_uri)
);

create type sync_status as enum ('queued', 'running', 'succeeded', 'failed');
create type sync_kind as enum ('backfill', 'incremental');

create table gsc_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  property_id uuid not null references gsc_properties(id) on delete cascade,
  kind sync_kind not null,
  status sync_status not null default 'queued',
  date_from date not null,
  date_to date not null,
  rows_imported integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index on gsc_sync_jobs (property_id, status);

create type gsc_search_type as enum ('web', 'image', 'video', 'news', 'discover');
create type gsc_device as enum ('DESKTOP', 'MOBILE', 'TABLET');

-- Granular fact table; upsert key makes re-imports idempotent.
create table gsc_daily_query_page (
  site_id uuid not null references sites(id) on delete cascade,
  property_id uuid not null references gsc_properties(id) on delete cascade,
  date date not null,
  page text not null,
  query text not null,
  country text not null default 'zzz',
  device gsc_device not null,
  search_type gsc_search_type not null default 'web',
  clicks integer not null,
  impressions integer not null,
  position double precision not null,
  primary key (property_id, date, page, query, country, device, search_type)
);
create index on gsc_daily_query_page (site_id, date);
create index on gsc_daily_query_page (site_id, query);
create index on gsc_daily_query_page (site_id, page);

-- Reconciliation for anonymised (omitted) queries: page/day totals delta.
create table gsc_daily_page_anonymised (
  property_id uuid not null references gsc_properties(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  date date not null,
  page text not null,
  clicks_delta integer not null,
  impressions_delta integer not null,
  primary key (property_id, date, page)
);

alter table google_connections enable row level security;
alter table gsc_properties enable row level security;
alter table gsc_sync_jobs enable row level security;
alter table gsc_daily_query_page enable row level security;
alter table gsc_daily_page_anonymised enable row level security;

create policy gsc_conn_by_org on google_connections for all
  using (is_org_member(organisation_id));
create policy gsc_props_by_org on gsc_properties for all
  using (is_org_member(organisation_id));
create policy gsc_jobs_by_org on gsc_sync_jobs for all
  using (is_org_member(organisation_id));
create policy gsc_facts_by_site on gsc_daily_query_page for select
  using (exists (select 1 from sites s
                 where s.id = site_id and is_org_member(s.organisation_id)));
create policy gsc_anon_by_site on gsc_daily_page_anonymised for select
  using (exists (select 1 from sites s
                 where s.id = site_id and is_org_member(s.organisation_id)));
