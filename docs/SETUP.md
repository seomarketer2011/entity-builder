# Setup Runbook (Phase 1)

What the operator must configure once. No credentials in this repo, chat,
or commits — see SECURITY.md.

## 1. Supabase project

1. Create a project at supabase.com.
2. Apply migrations in order: paste each `supabase/migrations/*.sql` into
   the SQL editor (or `supabase db push` with the CLI). Do NOT apply
   `supabase/tests/local_auth_stub.sql` — that is for local Postgres only.
3. Auth → enable Email provider (email + password).
4. Collect: project URL, anon key, service-role key (backend only), and
   the direct `DATABASE_URL` connection string (worker).

## 2. Google Cloud OAuth

1. Create a Google Cloud project; enable the **Search Console API**.
2. OAuth consent screen: external, scope
   `https://www.googleapis.com/auth/webmasters.readonly`.
3. Create an OAuth **web application** client. Authorised redirect URI:
   `https://<your-app-host>/api/google/callback`
   (for local dev: `http://localhost:3000/api/google/callback`).
4. Collect client ID + secret.

## 3. Token encryption key

```bash
openssl rand -base64 32
```

Set as `TOKEN_ENCRYPTION_KEY` for **both** web (encrypts on connect) and
worker (decrypts at sync time). Rotating it invalidates stored
connections; users just reconnect Google.

## 4. Environment

Copy `.env.example` to `.env.local` (web) and the worker's environment:

- web: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
  `GOOGLE_OAUTH_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`
- worker: `DATABASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`

## 5. Run

```bash
pnpm install
pnpm --filter @entity-builder/web dev      # dashboard on :3000
pnpm --filter @entity-builder/worker start # sync worker
```

## 6. First campaign walkthrough

1. Sign up (email confirm), create an organisation, then a campaign.
2. Add a site (base URL).
3. "Connect Google account" on the campaign page → consent → properties
   appear.
4. Link a property to its site, queue a **Backfill**.
5. Worker picks the job up within ~15s; watch the sync jobs table.
6. Open the Explorer once the job succeeds.

## 7. Scheduled daily syncs

Until the in-app scheduler ships (roadmap item 7 follow-up), schedule
incremental jobs with Supabase `pg_cron`:

```sql
select cron.schedule('gsc-daily', '30 5 * * *', $$
  insert into gsc_sync_jobs (organisation_id, property_id, kind, status, date_from, date_to)
  select p.organisation_id, p.id, 'incremental', 'queued',
         current_date - 5, current_date - 3
  from gsc_properties p
  where p.site_id is not null
$$);
```
