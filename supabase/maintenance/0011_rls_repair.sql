-- Idempotent RLS hardening for migration 0011.
--
-- Safe to run whether or not the amended 0011 already applied: it drops
-- the policies if present and recreates them with the site/organisation
-- binding, so the end state is correct either way. Run it as many times
-- as you like.
--
-- Why it matters: checking is_org_member(organisation_id) alone lets a
-- member of org A insert a row carrying their own organisation_id but
-- another tenant's site_id. The service-role analyzer selects conflicts
-- by site_id, so it would then fill that A-readable row with B's query
-- metrics — a cross-tenant leak.

begin;

create or replace function site_owned_by(p_site_id uuid, p_organisation_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sites s
    where s.id = p_site_id and s.organisation_id = p_organisation_id
  );
$$;

drop policy if exists query_conflicts_by_org on query_conflicts;
create policy query_conflicts_by_org on query_conflicts for all
  using (is_org_member(organisation_id) and site_owned_by(site_id, organisation_id))
  with check (is_org_member(organisation_id) and site_owned_by(site_id, organisation_id));

drop policy if exists query_conflict_snapshots_by_org on query_conflict_snapshots;
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

drop policy if exists entity_candidates_by_org on entity_candidates;
create policy entity_candidates_by_org on entity_candidates for all
  using (is_org_member(organisation_id) and site_owned_by(site_id, organisation_id))
  with check (is_org_member(organisation_id) and site_owned_by(site_id, organisation_id));

commit;

-- Verification: all three rows must read t / t.
select tablename,
       policyname,
       qual is not null       as has_using,
       with_check is not null as has_with_check
from pg_policies
where tablename in ('query_conflicts', 'query_conflict_snapshots', 'entity_candidates')
order by tablename;
