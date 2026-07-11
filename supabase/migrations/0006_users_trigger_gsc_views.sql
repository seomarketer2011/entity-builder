-- 0006: users/membership RLS gaps, mirror auth.users, GSC materialised views

-- 0001 left public.users without RLS and organisation_members without a
-- select policy. Close both: a user reads their own row and fellow members
-- of their organisations; memberships are visible to org members.
alter table users enable row level security;

create policy users_self_or_fellow_member on users for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from organisation_members mine
      join organisation_members theirs
        on mine.organisation_id = theirs.organisation_id
      where mine.user_id = auth.uid() and theirs.user_id = users.id
    )
  );

create policy members_by_org on organisation_members for select
  using (user_id = auth.uid() or is_org_member(organisation_id));

-- On Supabase, auth.users is managed by GoTrue. Mirror new signups into
-- public.users so FKs (reviewed_by, created_by, memberships) can reference
-- them.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Materialised views for UI aggregates (docs/GSC_INGESTION.md).
-- CTR is recomputed from sums; position is impression-weighted.

create materialized view gsc_daily_page as
select
  site_id,
  property_id,
  date,
  page,
  search_type,
  sum(clicks)::bigint as clicks,
  sum(impressions)::bigint as impressions,
  case when sum(impressions) > 0
       then sum(clicks)::double precision / sum(impressions) else 0 end as ctr,
  case when sum(impressions) > 0
       then sum(position * impressions) / sum(impressions) else null end as position
from gsc_daily_query_page
group by site_id, property_id, date, page, search_type;

create unique index gsc_daily_page_pk
  on gsc_daily_page (property_id, date, page, search_type);
create index gsc_daily_page_site on gsc_daily_page (site_id, date);

create materialized view gsc_daily_query as
select
  site_id,
  property_id,
  date,
  query,
  search_type,
  sum(clicks)::bigint as clicks,
  sum(impressions)::bigint as impressions,
  case when sum(impressions) > 0
       then sum(clicks)::double precision / sum(impressions) else 0 end as ctr,
  case when sum(impressions) > 0
       then sum(position * impressions) / sum(impressions) else null end as position
from gsc_daily_query_page
group by site_id, property_id, date, query, search_type;

create unique index gsc_daily_query_pk
  on gsc_daily_query (property_id, date, query, search_type);
create index gsc_daily_query_site on gsc_daily_query (site_id, date);

-- Concurrent refresh (requires the unique indexes above) so reads never block.
create or replace function refresh_gsc_views()
returns void language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently gsc_daily_page;
  refresh materialized view concurrently gsc_daily_query;
end;
$$;
