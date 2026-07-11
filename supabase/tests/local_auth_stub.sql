-- Local-only stub of Supabase's auth schema, for validating migrations and
-- RLS outside Supabase (e.g. throwaway Postgres in CI). NEVER applied to a
-- real Supabase project, where auth is managed by GoTrue.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- auth.uid() reads a session GUC so tests can impersonate users:
--   set local test.uid = '<uuid>';
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
