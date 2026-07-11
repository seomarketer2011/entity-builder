-- 0001: extensions, tenancy, campaigns, networks, sites, business truth

create extension if not exists pgcrypto;
-- pgvector / postgis are enabled on Supabase via the dashboard or:
-- create extension if not exists vector;
-- create extension if not exists postgis;

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key, -- mirrors auth.users.id on Supabase
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create type member_role as enum ('owner', 'editor', 'viewer');

create table organisation_members (
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name text not null,
  country_code text, -- primary regulatory jurisdiction, ISO 3166-1 alpha-2
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table networks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  domain text not null,
  base_url text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, domain)
);

create table network_sites (
  network_id uuid not null references networks(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  primary key (network_id, site_id)
);

-- Business truth: what each site's business genuinely does.
-- Populated from structured intake, never inferred by AI.
create type capability_kind as enum (
  'service_provided', 'service_not_provided', 'equipment', 'qualification',
  'customer_type', 'common_job', 'common_defect', 'deliverable',
  'pricing_variable', 'geographic_limit', 'faq', 'rejection_reason'
);

create table business_capabilities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  kind capability_kind not null,
  value text not null,
  detail text,
  source text not null default 'intake_form',
  created_at timestamptz not null default now()
);
create index on business_capabilities (site_id, kind);

-- RLS: enabled on all tenant tables; policies bind to organisation membership.
alter table organisations enable row level security;
alter table organisation_members enable row level security;
alter table campaigns enable row level security;
alter table networks enable row level security;
alter table sites enable row level security;
alter table network_sites enable row level security;
alter table business_capabilities enable row level security;

create or replace function is_org_member(org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organisation_members m
    where m.organisation_id = org_id and m.user_id = auth.uid()
  );
$$;

create policy org_member_select on organisations for select
  using (is_org_member(id));
create policy campaigns_by_org on campaigns for all
  using (is_org_member(organisation_id));
create policy networks_by_org on networks for all
  using (is_org_member(organisation_id));
create policy sites_by_org on sites for all
  using (is_org_member(organisation_id));
create policy capabilities_by_org on business_capabilities for all
  using (is_org_member(organisation_id));
