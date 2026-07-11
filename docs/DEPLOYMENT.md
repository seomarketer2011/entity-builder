# Deployment Record

Live infrastructure and exactly where to find it. No secrets in this file —
see SECURITY.md for where credentials live.

## Cloudflare (dashboard hosting)

| What | Value |
| --- | --- |
| Account name | `Zhl102600813@gmail.com's Account` |
| Account email | `Zhl102600813@gmail.com` |
| Account ID | `da9a9a141346a7571024b0283c0c60e3` |
| Worker name | `entity-builder-web` |
| workers.dev subdomain | `entity-builder-hq.workers.dev` |
| App URL | `https://entity-builder-web.entity-builder-hq.workers.dev` |

The auth in use is a **Global API Key with access to many accounts**
(agency/super-admin setup). The account above was selected by the
`CLOUDFLARE_ACCOUNT_ID` environment variable at deploy time. If the app
ever "disappears", check you are looking at THIS account in the
Cloudflare dashboard's account switcher.

Recommended hardening: replace the global key in the deploy environment
with a scoped API token limited to this one account (permission:
Workers Scripts → Edit), so a leaked credential cannot touch the other
accounts.

Deploy command (from `apps/web/`): `pnpm deploy:cf`
Public env vars live in `apps/web/wrangler.jsonc` (`vars`).
Secrets (Google OAuth, token encryption key) are set with
`npx wrangler secret put <NAME>` and stored only in Cloudflare.

## Supabase (database + auth)

| What | Value |
| --- | --- |
| Project URL | `https://ycehhndxcoiinjvdngph.supabase.co` |
| Project ref | `ycehhndxcoiinjvdngph` |
| Region | West EU (Ireland) |
| Publishable (anon) key | `sb_publishable_N7GjEH36rA0BXJdelicpdA_HFZ_1W9c` |

Schema state: migrations 0001–0008 applied manually via SQL Editor
(2026-07-11). Future migrations: apply via SQL Editor, or connect the
GitHub integration once the branch is merged to `main`.

## Not yet deployed

- `apps/worker` (GSC sync worker) — needs a container host (Railway/Fly)
  or a Cloudflare Worker cron adaptation. Requires `DATABASE_URL`,
  `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `TOKEN_ENCRYPTION_KEY`.
- Google OAuth client — not created yet (docs/SETUP.md §2). Redirect URI:
  `https://entity-builder-web.entity-builder-hq.workers.dev/api/google/callback`
