-- 0010: query+page aggregates for cannibalisation / cluster detectors.
-- SECURITY INVOKER — caller's RLS applies (org members see own sites only).

create or replace function gsc_query_page_totals(
  p_site_id uuid, p_from date, p_to date, p_limit integer default 2000
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
  where site_id = p_site_id and date between p_from and p_to
  group by query, page
  order by sum(impressions) desc
  limit least(p_limit, 5000)
$$;
