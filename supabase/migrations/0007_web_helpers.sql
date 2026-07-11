-- 0007: helpers the dashboard needs
-- 1. create_organisation: org + owner membership atomically (RLS-safe)
-- 2. explorer aggregate functions (security INVOKER — RLS applies)
-- 3. keep materialised views out of PostgREST (no RLS on matviews)

create or replace function create_organisation(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if org_name is null or length(trim(org_name)) = 0 then
    raise exception 'organisation name is required';
  end if;
  insert into organisations (name) values (trim(org_name)) returning id into new_org_id;
  insert into organisation_members (organisation_id, user_id, role)
  values (new_org_id, auth.uid(), 'owner');
  return new_org_id;
end;
$$;

-- Explorer aggregates over the granular fact table. SECURITY INVOKER means
-- the caller's RLS policies apply — a user can only aggregate sites in
-- their organisations. CTR from sums; position impression-weighted.
create or replace function gsc_query_totals(
  p_site_id uuid, p_from date, p_to date, p_limit integer default 100
)
returns table(
  query text, clicks bigint, impressions bigint,
  ctr double precision, "position" double precision
)
language sql stable security invoker as $$
  select query,
         sum(clicks)::bigint,
         sum(impressions)::bigint,
         case when sum(impressions) > 0
              then sum(clicks)::double precision / sum(impressions) else 0 end,
         case when sum(impressions) > 0
              then sum(position * impressions) / sum(impressions) else null end
  from gsc_daily_query_page
  where site_id = p_site_id and date between p_from and p_to
  group by query
  order by sum(clicks) desc, sum(impressions) desc
  limit least(p_limit, 1000)
$$;

create or replace function gsc_page_totals(
  p_site_id uuid, p_from date, p_to date, p_limit integer default 100
)
returns table(
  page text, clicks bigint, impressions bigint,
  ctr double precision, "position" double precision
)
language sql stable security invoker as $$
  select page,
         sum(clicks)::bigint,
         sum(impressions)::bigint,
         case when sum(impressions) > 0
              then sum(clicks)::double precision / sum(impressions) else 0 end,
         case when sum(impressions) > 0
              then sum(position * impressions) / sum(impressions) else null end
  from gsc_daily_query_page
  where site_id = p_site_id and date between p_from and p_to
  group by page
  order by sum(clicks) desc, sum(impressions) desc
  limit least(p_limit, 1000)
$$;

create or replace function gsc_daily_totals(p_site_id uuid, p_from date, p_to date)
returns table(
  date date, clicks bigint, impressions bigint,
  ctr double precision, "position" double precision
)
language sql stable security invoker as $$
  select date,
         sum(clicks)::bigint,
         sum(impressions)::bigint,
         case when sum(impressions) > 0
              then sum(clicks)::double precision / sum(impressions) else 0 end,
         case when sum(impressions) > 0
              then sum(position * impressions) / sum(impressions) else null end
  from gsc_daily_query_page
  where site_id = p_site_id and date between p_from and p_to
  group by date
  order by date
$$;

-- Materialised views cannot carry RLS: make sure Supabase's API roles
-- cannot read them. They are for trusted backend aggregation only.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on gsc_daily_page, gsc_daily_query from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on gsc_daily_page, gsc_daily_query from authenticated;
  end if;
end $$;
