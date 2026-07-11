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
end $$;

reset role;
select 'RLS tests passed' as result;

rollback;
