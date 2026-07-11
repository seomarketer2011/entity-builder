# apps/web

Next.js dashboard: Supabase auth, organisations/campaigns/sites CRUD,
Google Search Console connect (server-side OAuth, encrypted refresh
tokens), sync-job dashboard, and the GSC explorer.

Env (see `.env.example` at the repo root): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
(`https://<host>/api/google/callback`), `TOKEN_ENCRYPTION_KEY`.

```bash
pnpm --filter @entity-builder/web dev
```

Tenant isolation: all reads/writes go through the user's Supabase session
client, so RLS applies everywhere; the explorer uses SECURITY INVOKER
aggregate functions (migration 0007). The service-role key is never used
in this app.
