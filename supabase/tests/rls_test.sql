-- RLS behaviour test. Run against a database with all migrations applied
-- and a local auth stub whose auth.uid() reads current_setting('test.uid')
-- (see supabase/tests/local_auth_stub.sql). Fails loudly on any violation.

begin;

-- Two orgs, one user in each
insert into users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

insert into organisations (id, name) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B');

insert into organisation_members (organisation_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-00000000000b', 'owner');

insert into campaigns (id, organisation_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a0', 'Campaign A'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b0', 'Campaign B');

-- One site per org, so the 0011 tenant-scoped tables have something to hang off.
insert into sites (id, organisation_id, campaign_id, name, domain, base_url) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a0',
   '00000000-0000-0000-0000-0000000000a1', 'Site A', 'a.example', 'https://a.example'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b0',
   '00000000-0000-0000-0000-0000000000b1', 'Site B', 'b.example', 'https://b.example');

insert into query_conflicts (id, organisation_id, site_id, query) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a0',
   '00000000-0000-0000-0000-0000000000a2', 'locksmith a'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b0',
   '00000000-0000-0000-0000-0000000000b2', 'locksmith b');

insert into query_conflict_snapshots
  (conflict_id, captured_on, status, contender_count, total_impressions, total_clicks) values
  ('00000000-0000-0000-0000-0000000000a3', '2026-01-01', 'new', 2, 100, 5),
  ('00000000-0000-0000-0000-0000000000b3', '2026-01-01', 'new', 2, 100, 5);

insert into entity_candidates
  (organisation_id, site_id, discovery_source, suggested_name, suggested_type) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000a2',
   'gsc_demand', 'Candidate A', 'service'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000b2',
   'gsc_demand', 'Candidate B', 'service');

-- Simulate an authenticated (non-superuser, non-bypass) session as user A
create role rls_test_user login;
grant usage on schema public to rls_test_user;
grant select, insert, update, delete on all tables in schema public to rls_test_user;
grant execute on all functions in schema public to rls_test_user;

set role rls_test_user;
set local test.uid = '00000000-0000-0000-0000-00000000000a';

do $$
declare n integer;
begin
  -- sees own org only
  select count(*) into n from organisations;
  if n <> 1 then raise exception 'RLS FAIL: user A sees % organisations, expected 1', n; end if;

  select count(*) into n from campaigns;
  if n <> 1 then raise exception 'RLS FAIL: user A sees % campaigns, expected 1', n; end if;

  select count(*) into n from campaigns where organisation_id = '00000000-0000-0000-0000-0000000000b0';
  if n <> 0 then raise exception 'RLS FAIL: user A can see org B campaigns'; end if;

  -- sees only self + fellow org members in users
  select count(*) into n from users;
  if n <> 1 then raise exception 'RLS FAIL: user A sees % users, expected 1 (self)', n; end if;

  -- sees own membership rows only
  select count(*) into n from organisation_members;
  if n <> 1 then raise exception 'RLS FAIL: user A sees % memberships, expected 1', n; end if;

  -- cannot insert into another org's campaign space
  begin
    insert into campaigns (organisation_id, name)
    values ('00000000-0000-0000-0000-0000000000b0', 'intruder');
    raise exception 'RLS FAIL: user A inserted a campaign into org B';
  exception when insufficient_privilege or check_violation then
    null; -- expected: RLS blocks the write
  end;

  -- 0011 tables: conflict tracking and mined entity candidates are
  -- tenant-scoped and must never leak across organisations.
  select count(*) into n from query_conflicts;
  if n <> 1 then raise exception 'RLS FAIL: user A sees % conflicts, expected 1', n; end if;

  select count(*) into n from query_conflict_snapshots;
  if n <> 1 then raise exception 'RLS FAIL: user A sees % conflict snapshots, expected 1', n; end if;

  select count(*) into n from entity_candidates;
  if n <> 1 then raise exception 'RLS FAIL: user A sees % entity candidates, expected 1', n; end if;

  begin
    insert into query_conflicts (organisation_id, site_id, query)
    values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000b2', 'intruder');
    raise exception 'RLS FAIL: user A inserted a conflict into org B';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;

  begin
    insert into entity_candidates
      (organisation_id, site_id, discovery_source, suggested_name, suggested_type)
    values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000b2',
            'gsc_demand', 'intruder', 'service');
    raise exception 'RLS FAIL: user A inserted a candidate into org B';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;

  -- The subtle one: OWN organisation_id paired with ANOTHER tenant's
  -- site_id. Checking org membership alone would allow this, and the
  -- service-role analyzer — which selects by site_id — would then fill the
  -- attacker-readable row with the victim site's metrics.
  begin
    insert into query_conflicts (organisation_id, site_id, query)
    values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b2',
            'cross tenant');
    raise exception 'RLS FAIL: user A attached a conflict to org B''s site';
  exception when insufficient_privilege or check_violation then
    null; -- expected: site_owned_by() forces the columns to agree
  end;

  begin
    insert into entity_candidates
      (organisation_id, site_id, discovery_source, suggested_name, suggested_type)
    values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b2',
            'gsc_demand', 'cross tenant', 'service');
    raise exception 'RLS FAIL: user A attached a candidate to org B''s site';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;

  -- Positive control: the binding must not block legitimate work. This is
  -- exactly what the "Mark seen" action does through the user's session.
  update query_conflicts
     set acknowledged_at = now(), acknowledged_by = '00000000-0000-0000-0000-00000000000a'
   where id = '00000000-0000-0000-0000-0000000000a3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS FAIL: user A cannot acknowledge their own conflict'; end if;

  insert into query_conflicts (organisation_id, site_id, query)
  values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000a2', 'own row');

  -- Updating a legitimately-owned row to point at another tenant's site
  -- must fail too (WITH CHECK applies to UPDATE, not just INSERT).
  begin
    update query_conflicts
       set site_id = '00000000-0000-0000-0000-0000000000b2'
     where id = '00000000-0000-0000-0000-0000000000a3';
    raise exception 'RLS FAIL: user A repointed a conflict at org B''s site';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;
end $$;

reset role;
select 'RLS tests passed' as result;

rollback;
