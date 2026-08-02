-- 0011: query ownership, conflict lifecycle tracking, entity candidates.
--
-- Three things:
--   1. gsc_query_owner_totals — the owning URL for each query plus the
--      competitor count, so the Explorer can show which page actually
--      earns a query instead of hiding it behind a group-by.
--   2. query_conflicts / query_conflict_snapshots — a conflict is tracked
--      per (site, query) over successive analysis runs so the operator can
--      see whether their fix is working. Status rules live in
--      packages/scoring/src/conflict-lifecycle.ts and are documented in
--      docs/OPPORTUNITY_RULES.md.
--   3. entity_candidates — mined entity proposals, org-scoped staging.
--      Never written into the shared master `entities` table until a human
--      approves them (non-negotiable rule 3).

-- ---------------------------------------------------------------------------
-- 1. Query ownership
-- ---------------------------------------------------------------------------

-- Per query: aggregate metrics, the URL taking the most impressions
-- ("owner"), that URL's share, how many distinct URLs appeared at all, and
-- how many are genuine contenders (>= 25% impression share — the
-- CANNIBALISATION.minShare constant in packages/scoring).
-- SECURITY INVOKER — the caller's RLS applies.
create or replace function gsc_query_owner_totals(
  p_site_id uuid, p_from date, p_to date, p_limit integer default 1000,
  p_min_share double precision default 0.25
)
returns table(
  query text, clicks bigint, impressions bigint,
  ctr double precision, "position" double precision,
  owner_page text, owner_impressions bigint, owner_share double precision,
  url_count integer, contender_count integer
)
language sql stable security invoker as $$
  with pairs as (
    select query, page,
           sum(clicks)::bigint as clicks,
           sum(impressions)::bigint as impressions,
           case when sum(impressions) > 0
                then sum(position * impressions) / sum(impressions) end as position
    from gsc_daily_query_page
    where site_id = p_site_id and date between p_from and p_to
    group by query, page
  ),
  totals as (
    select query,
           sum(clicks)::bigint as clicks,
           sum(impressions)::bigint as impressions,
           count(*)::integer as url_count
    from pairs
    group by query
  ),
  ranked as (
    select p.query, p.page, p.impressions,
           row_number() over (partition by p.query order by p.impressions desc, p.page) as rn
    from pairs p
  ),
  contenders as (
    select p.query, count(*)::integer as contender_count
    from pairs p
    join totals t on t.query = p.query
    where t.impressions > 0
      and p.impressions::double precision / t.impressions >= p_min_share
    group by p.query
  ),
  weighted as (
    select p.query,
           case when sum(p.impressions) > 0
                then sum(p.position * p.impressions) / sum(p.impressions) end as position
    from pairs p
    where p.position is not null
    group by p.query
  )
  select t.query,
         t.clicks,
         t.impressions,
         case when t.impressions > 0
              then t.clicks::double precision / t.impressions else 0 end,
         w.position,
         r.page,
         r.impressions,
         case when t.impressions > 0
              then r.impressions::double precision / t.impressions else 0 end,
         t.url_count,
         coalesce(c.contender_count, 0)
  from totals t
  join ranked r on r.query = t.query and r.rn = 1
  left join contenders c on c.query = t.query
  left join weighted w on w.query = t.query
  order by t.clicks desc, t.impressions desc
  limit least(p_limit, 5000)
$$;

-- Complete (query, page) rows for an explicit list of queries.
--
-- gsc_query_page_totals is globally ordered and limited, so on a large site
-- a tracked query can fall outside the cutoff, or have only some of its
-- pages survive it. Conflict tracking must never read that as "the query
-- lost its impressions" or compute an owner share from partial pages — it
-- would write a permanent, wrong `collapsed` snapshot. This function is
-- bounded by the number of queries asked for, not by a global row cap.
create or replace function gsc_query_page_totals_for_queries(
  p_site_id uuid, p_from date, p_to date, p_queries text[]
)
returns table(
  query text, page text, clicks bigint, impressions bigint,
  ctr double precision, "position" double precision
)
language sql stable security invoker as $$
  select query,
         page,
         sum(clicks)::bigint,
         sum(impressions)::bigint,
         case when sum(impressions) > 0
              then sum(clicks)::double precision / sum(impressions) else 0 end,
         case when sum(impressions) > 0
              then sum(position * impressions) / sum(impressions) else null end
  from gsc_daily_query_page
  where site_id = p_site_id
    and date between p_from and p_to
    and query = any(p_queries)
  group by query, page
$$;

-- ---------------------------------------------------------------------------
-- 2. Conflict lifecycle
-- ---------------------------------------------------------------------------

-- Tracked per (site, query) rather than per page-set: when a losing page
-- drops out, the page-set changes but the query does not, so a query key is
-- what lets "the conflict resolved" be distinguished from "a different
-- conflict appeared".
create type query_conflict_status as enum (
  'new',        -- first detection
  'ongoing',    -- still contested, no material improvement
  'improving',  -- owner share up or contenders down, not yet resolved
  'resolved',   -- owner dominant AND demand retained
  'collapsed',  -- contention gone but impressions fell — not a win
  'regressed'   -- was resolved, now contested again
);

create table query_conflicts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  query text not null,
  status query_conflict_status not null default 'new',
  -- Snapshot of the most recent analysis run.
  owner_page text,
  owner_share double precision,
  contender_count integer not null default 0,
  total_impressions bigint not null default 0,
  total_clicks bigint not null default 0,
  best_position double precision,
  -- Baseline captured at first detection; "have impressions fallen?" is
  -- measured against this, never against the previous run (so a slow
  -- multi-week decline cannot be mistaken for a fix).
  baseline_impressions bigint not null default 0,
  baseline_owner_share double precision,
  baseline_contender_count integer not null default 0,
  peak_contender_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  regressed_at timestamptz,
  -- Operator state. Acknowledging silences the "new" highlight without
  -- changing the measured status.
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(id),
  note text,
  unique (site_id, query)
);
create index on query_conflicts (site_id, status, total_impressions desc);
create index on query_conflicts (organisation_id, status);

-- One row per analysis run per conflict. Powers the share-split trend.
create table query_conflict_snapshots (
  id uuid primary key default gen_random_uuid(),
  conflict_id uuid not null references query_conflicts(id) on delete cascade,
  captured_on date not null default current_date,
  status query_conflict_status not null,
  owner_page text,
  owner_share double precision,
  contender_count integer not null,
  total_impressions bigint not null,
  total_clicks bigint not null,
  best_position double precision,
  -- [{ page, impressions, clicks, share, position }] for every contender.
  contenders jsonb not null default '[]'::jsonb,
  window_from date,
  window_to date,
  created_at timestamptz not null default now(),
  -- Re-running the analysis on the same day updates that day's row rather
  -- than stacking duplicates, so the trend stays one point per day.
  unique (conflict_id, captured_on)
);
create index on query_conflict_snapshots (conflict_id, captured_on desc);

alter table query_conflicts enable row level security;
alter table query_conflict_snapshots enable row level security;

-- Checking is_org_member(organisation_id) alone is NOT enough: a member of
-- org A could insert a row carrying their own organisation_id but another
-- tenant's site_id. The service-role analyzer selects by site_id, so it
-- would then fill that attacker-readable row with the victim site's
-- metrics. site_owned_by() forces the two columns to agree.
create or replace function site_owned_by(p_site_id uuid, p_organisation_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sites s
    where s.id = p_site_id and s.organisation_id = p_organisation_id
  );
$$;

create policy query_conflicts_by_org on query_conflicts for all
  using (is_org_member(organisation_id) and site_owned_by(site_id, organisation_id))
  with check (is_org_member(organisation_id) and site_owned_by(site_id, organisation_id));

create policy query_conflict_snapshots_by_org on query_conflict_snapshots for all
  using (
    exists (
      select 1 from query_conflicts c
      where c.id = conflict_id and is_org_member(c.organisation_id)
    )
  )
  with check (
    exists (
      select 1 from query_conflicts c
      where c.id = conflict_id and is_org_member(c.organisation_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Entity candidates (mined proposals)
-- ---------------------------------------------------------------------------

create type entity_discovery_source as enum ('gsc_demand', 'serp_competitor');

-- Staging for mined entity proposals. Org-scoped on purpose: the shared
-- master `entities` graph must not be polluted by one tenant's unreviewed
-- mining output. Approval copies a candidate into `entities` as 'proposed'.
create table entity_candidates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  industry_id uuid references industries(id) on delete cascade,
  discovery_source entity_discovery_source not null,
  suggested_name text not null,
  suggested_type entity_type not null,
  -- Where this would attach in the graph, and how.
  suggested_parent_entity_id uuid references entities(id) on delete set null,
  suggested_predicate relationship_predicate,
  -- Location split out of the query ("emergency locksmith croydon" ->
  -- service 'Emergency locksmith' + location 'Croydon').
  location_name text,
  location_id uuid references locations(id) on delete set null,
  -- Demand evidence (non-negotiable rule 2 — nothing is proposed bare).
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  best_position double precision,
  query_count integer not null default 0,
  sample_queries jsonb not null default '[]'::jsonb,
  -- Set when the miner matched this to something already in the graph;
  -- such rows are shown as "already covered", not as new proposals.
  matched_entity_id uuid references entities(id) on delete cascade,
  -- Rule 1: a candidate can only be approved onto a site whose
  -- business_capabilities support it. Set by the miner, re-checked on approve.
  capability_supported boolean,
  capability_note text,
  status review_status not null default 'candidate',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  approved_entity_id uuid references entities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT so re-mining updates a candidate instead of
  -- inserting a duplicate when location_name is null (PG15+).
  unique nulls not distinct
    (site_id, discovery_source, suggested_name, location_name)
);
create index on entity_candidates (site_id, status, impressions desc);
create index on entity_candidates (organisation_id, status);

alter table entity_candidates enable row level security;

-- Same site/organisation binding as query_conflicts above: without it a
-- member of one org could stage a candidate against another org's site.
create policy entity_candidates_by_org on entity_candidates for all
  using (is_org_member(organisation_id) and site_owned_by(site_id, organisation_id))
  with check (is_org_member(organisation_id) and site_owned_by(site_id, organisation_id));
