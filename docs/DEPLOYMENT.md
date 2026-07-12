# Deployment Record

Live infrastructure and exactly where to find it. No secrets in this file —
see SECURITY.md for where credentials live.

## Cloudflare (dashboard hosting)

| What | Value |
| --- | --- |
| Account name | `Seomarketer2011@yahoo.co.uk's Account` |
| Account email | `Seomarketer2011@yahoo.co.uk` |
| Account ID | `44799b719f2192a9f066f425aaff3106` |
| Worker name | `entity-builder-web` |
| workers.dev subdomain | `seomarketer2011.workers.dev` |
| App URL | `https://entity-builder-web.seomarketer2011.workers.dev` |

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

## Fully deployed pipeline

- Plan: **Workers Paid** on this account (2026-07-12); `limits.cpu_ms`
  raised for heavy backfills.
- Sync engine: `/api/internal/sync` on the web worker (multi-window per
  call, per-window progress persistence, 2-min stale reclaim).
- Scheduler: `entity-builder-cron` worker — every 2 min sync step,
  05:30 UTC daily incremental queueing, 07:00 UTC opportunity analysis.
- Google OAuth client: configured (redirect
  `https://entity-builder-web.seomarketer2011.workers.dev/api/google/callback`);
  active connection `pauldanielstone@gmail.com` (27 properties).
- `apps/worker` (container poll-loop variant) remains for self-hosting.
