-- 0003: crawls and page inventory

create table crawls (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  status sync_status not null default 'queued',
  pages_found integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  url text not null,
  path text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_indexable boolean,
  unique (site_id, url)
);
create index on pages (site_id, path);

create table page_snapshots (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  crawl_id uuid not null references crawls(id) on delete cascade,
  title text,
  meta_description text,
  canonical_url text,
  status_code integer,
  word_count integer,
  content_hash text,
  captured_at timestamptz not null default now()
);
create index on page_snapshots (page_id, captured_at desc);

create table page_headings (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references page_snapshots(id) on delete cascade,
  level smallint not null check (level between 1 and 6),
  position integer not null,
  text text not null
);

create table page_links (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references page_snapshots(id) on delete cascade,
  target_url text not null,
  anchor_text text,
  is_internal boolean not null
);
create index on page_links (snapshot_id);

create table page_schema (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references page_snapshots(id) on delete cascade,
  schema_type text not null, -- e.g. Service, LocalBusiness, Article
  raw jsonb not null
);

alter table crawls enable row level security;
alter table pages enable row level security;
alter table page_snapshots enable row level security;
alter table page_headings enable row level security;
alter table page_links enable row level security;
alter table page_schema enable row level security;

create policy crawls_by_org on crawls for all using (is_org_member(organisation_id));
create policy pages_by_org on pages for all using (is_org_member(organisation_id));
create policy snapshots_by_page on page_snapshots for select
  using (exists (select 1 from pages p where p.id = page_id and is_org_member(p.organisation_id)));
create policy headings_by_snapshot on page_headings for select
  using (exists (select 1 from page_snapshots s join pages p on p.id = s.page_id
                 where s.id = snapshot_id and is_org_member(p.organisation_id)));
create policy links_by_snapshot on page_links for select
  using (exists (select 1 from page_snapshots s join pages p on p.id = s.page_id
                 where s.id = snapshot_id and is_org_member(p.organisation_id)));
create policy schema_by_snapshot on page_schema for select
  using (exists (select 1 from page_snapshots s join pages p on p.id = s.page_id
                 where s.id = snapshot_id and is_org_member(p.organisation_id)));
