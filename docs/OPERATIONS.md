# Operations & Handoff — READ THIS FIRST

The single source of truth for anyone (human or AI) picking this project up
cold. If you read only one file, read this one, then follow its links.
Last substantive update: 2026-07-12.

---

## 1. What this project is (30 seconds)

**Entity Builder / SEO Opportunity Engine.** A multi-tenant platform that
pulls Google Search Console data for a network of service-business
websites, stores it permanently, and turns it into a ranked, evidence-backed
to-do list of SEO fixes — plus a verified industry entity graph that decides
which page should own which topic. Full product intent: `docs/PRODUCT_SPEC.md`.

The owner is Paul Daniel Stone, running a network of ~100 UK locksmith /
electrician service sites (login email for the app: pde1979@outlook.com;
Google/GSC data lives under pauldanielstone@gmail.com).

**It is LIVE and self-running in production.** See §3 for URLs.

---

## 2. Current status at a glance (2026-07-12)

- **Phase 0** (foundation), **Phase 1** (auth + GSC ingestion),
  **Phase 2** (opportunity detectors), **Phase 3 V1** (entity graph): all
  built, deployed, and running. See `docs/ROADMAP.md` for the phase plan.
- **Data:** 110,219 GSC fact rows across **6 linked sites**
  (JDS Electricians Fulham, CR9 Locksmiths Croydon, Lockhub Locksmiths
  Nottingham, Boltfix Locksmiths, Lockman Locksmiths Birmingham, EICR
  Certificates London). 27 GSC properties are discovered; more can be linked.
- **19 open opportunities** in the feed (cannibalisation, striking-distance,
  unowned-cluster findings).
- **Entity graph:** locksmith-services template imported — **30 entities in
  `proposed` status, awaiting human approval** (see §7 outstanding items).
- **Tests:** 65 passing across the packages. **Migrations:** 0001–0010, all
  validated on Postgres 16.

Development happens on branch **`claude/entity-topical-authority-1ah7km`**.
It is **NOT yet merged to `main`** — deployment is done directly from this
branch via Wrangler (see §6), not via a git-based CI pipeline.

---

## 3. Live infrastructure — where everything runs

### The app
- **URL: https://entity-builder-web.seomarketer2011.workers.dev**
- Hosted as a Cloudflare **Worker** (`entity-builder-web`), built from the
  Next.js app in `apps/web` via the OpenNext Cloudflare adapter.

### Cloudflare account (hosting)
| | |
| --- | --- |
| Account name | `Seomarketer2011@yahoo.co.uk's Account` |
| Account ID | `44799b719f2192a9f066f425aaff3106` |
| Plan | **Workers Paid** ($5/mo) — needed for backfill compute |
| workers.dev subdomain | `seomarketer2011.workers.dev` |
| Workers | `entity-builder-web` (the app), `entity-builder-cron` (scheduler) |

The deploy environment authenticates to Cloudflare with a **Global API Key**
(env vars `CLOUDFLARE_EMAIL` / `CLOUDFLARE_API_KEY`) that can see ~475
accounts. `CLOUDFLARE_ACCOUNT_ID` selects which one. **Always deploy with
`CLOUDFLARE_ACCOUNT_ID=44799b719f2192a9f066f425aaff3106`** or the app lands
in the wrong account. Hardening TODO: swap the global key for a token scoped
to this one account.

### Supabase (database + auth)
| | |
| --- | --- |
| Project URL | `https://ycehhndxcoiinjvdngph.supabase.co` |
| Project ref | `ycehhndxcoiinjvdngph` |
| Region | West EU (Ireland) |
| Publishable (anon) key | `sb_publishable_N7GjEH36rA0BXJdelicpdA_HFZ_1W9c` (browser-safe) |
| Dashboard | https://supabase.com/dashboard/project/ycehhndxcoiinjvdngph |

Schema is at migration **0010**. Migrations were applied **manually via the
SQL Editor** (the GitHub↔Supabase integration is not connected because the
branch isn't merged). To apply a new migration: paste its SQL into the
Supabase SQL Editor and Run. Local validation harness:
`supabase/tests/` (see §6).

### Google Cloud (OAuth for Search Console)
- OAuth **web client** configured; consent screen in "testing" mode (add
  Google accounts as *test users* before they can connect).
- Redirect URI (must match exactly):
  `https://entity-builder-web.seomarketer2011.workers.dev/api/google/callback`
- Active connection in the DB: **pauldanielstone@gmail.com** (27 properties).

---

## 4. Credentials — where they live (NEVER in git or chat)

`.env.example` lists every variable name. Secret **values** live only in:

- **Cloudflare Worker secrets** on `entity-builder-web` (set via
  `npx wrangler secret put NAME`): `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_TOKEN`.
- **`entity-builder-cron`** worker: `SYNC_TOKEN` (must match the web
  worker's — they are rotated together).
- **Public (browser-safe) vars** live in `apps/web/wrangler.jsonc` under
  `vars`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `GOOGLE_OAUTH_REDIRECT_URI`.

Key facts a new operator must know:
- `TOKEN_ENCRYPTION_KEY` encrypts Google refresh tokens at rest
  (AES-256-GCM). **If it is ever changed, every existing Google connection
  breaks** and users must click "Connect Google account" again. This is
  exactly what happened during the Cloudflare account move — hence the
  reconnect steps in the history.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses all row-level security. Backend only.
- `SYNC_TOKEN` is the bearer secret protecting the internal
  `/api/internal/*` endpoints. Rotate on the web AND cron worker together.
- Full policy: `docs/SECURITY.md`.

---

## 5. How the system runs itself (the automation)

Two Cloudflare Workers do everything; no human action is needed for daily
operation.

**`entity-builder-cron`** fires three schedules (UTC), each POSTing to an
internal endpoint on the web worker (via a service binding, authenticated
with `SYNC_TOKEN`):

| Cron | Endpoint | What it does |
| --- | --- | --- |
| `*/2 * * * *` | `/api/internal/sync` | Claims the oldest queued sync job, imports one or more month-windows of GSC data (idempotent upserts), refreshes materialised views when a job completes. |
| `30 5 * * *` | `/api/internal/schedule-daily` | Queues an incremental sync for every linked property with an active Google connection. |
| `0 7 * * *` | `/api/internal/analyze` | Runs all opportunity detectors over every site's last 28 days; regenerates the open opportunity feed. |

Data flow: **GSC → daily scheduler → sync engine (every 2 min) → Postgres →
detectors (nightly) → opportunity feed / explorer.**

The sync engine is **self-healing**: it persists progress after every
month-window, and any job stuck "running" with no heartbeat for 2 minutes is
automatically re-queued. Re-runs are always safe (idempotent upsert key on
`gsc_daily_query_page`). Details: `docs/GSC_INGESTION.md`.

There is also a `apps/worker` Node process (a container-based poll-loop
variant of the same sync logic) kept for self-hosting; it is **not used in
production** — Cloudflare cron is.

---

## 6. How to make changes and deploy

Prereqs: `pnpm install` at the repo root. Node 20+.

**Standard checks (run before any deploy):**
```bash
pnpm typecheck      # all packages
pnpm test           # 65 tests (vitest)
```

**Validate a new migration locally** (needs postgres 16 binaries):
```bash
# starts a throwaway PG, applies auth stub + all migrations + RLS tests
# (see the pattern used throughout the git history; supabase/tests/ holds
#  local_auth_stub.sql and rls_test.sql)
```
Then apply it in production by pasting the SQL into the Supabase SQL Editor.

**Deploy the web app** (from `apps/web`):
```bash
export CLOUDFLARE_ACCOUNT_ID=44799b719f2192a9f066f425aaff3106
npx opennextjs-cloudflare build
npx opennextjs-cloudflare deploy
```

**Deploy the cron worker** (from `apps/cron`):
```bash
export CLOUDFLARE_ACCOUNT_ID=44799b719f2192a9f066f425aaff3106
npx wrangler deploy
```

**Commit convention:** work on `claude/entity-topical-authority-1ah7km`,
push there. A PR to `main` has NOT been opened yet — do so only when the
owner asks. Once merged, connect the Supabase GitHub integration so
migrations apply automatically.

### Repository map
- `docs/` — all specs and rules (this file, plus the phase docs).
- `packages/domain` — shared TS types mirroring the DB.
- `packages/scoring` — **pure, fully-tested** engines: entity validator,
  page-creation gate, opportunity priority, and all detectors
  (`detectors.ts` = V1 striking-distance/CTR-gap, `detectors-v2.ts` =
  declining/cannibalisation/unowned-cluster). Thresholds here MUST match
  `docs/OPPORTUNITY_RULES.md` and `docs/ENTITY_SYSTEM.md`.
- `packages/gsc` — Google OAuth, token crypto, Search Console client, sync
  planning. `packages/database` — pg helpers. `packages/entity-engine` —
  normalisation/alias logic.
- `apps/web` — Next.js dashboard + all `/api/internal/*` endpoints.
  Key routes: `app/api/google/{connect,callback,debug}`,
  `app/api/internal/{sync,schedule-daily,analyze,import-industry,review-entity}`.
- `apps/cron` — the scheduler worker.
- `fixtures/entities/` — curated industry graph templates.

---

## 7. Outstanding items / things a new operator should action

1. **Rotate the Supabase secret key.** During setup an `sb_secret_…` key
   was pasted into a chat and is still in use on the worker. Recommended:
   Supabase → Project Settings → API Keys → delete the old secret key →
   create a new one → set it as `SUPABASE_SERVICE_ROLE_KEY` on the
   `entity-builder-web` worker (`npx wrangler secret put`).
2. **Approve the entity graph.** 30 locksmith entities are `proposed`. In
   the app: campaign → **Entity graph** → review and **Approve** the ones
   these businesses genuinely provide (reject the rest). Nothing downstream
   (page manifests) can proceed until this is done. Rule: humans approve;
   the system never auto-promotes (`docs/ENTITY_SYSTEM.md`).
3. **Link more sites.** Only 6 of ~27 discovered GSC properties are linked.
   To onboard: campaign page → Add site (bare domain is fine) → filter the
   property list → Link → Queue a **Backfill**. Backfills run automatically
   thereafter; nightly analysis folds new sites in.
4. **Connect other Google accounts** if properties live under logins other
   than pauldanielstone@gmail.com (add them as OAuth test users first).

---

## 8. Known quirks & gotchas (hard-won — don't relearn these)

- **Same-account workers.dev fetch is blocked** (Cloudflare error 1042).
  The cron worker therefore calls the web worker through a **service
  binding**, not its public URL. Don't "simplify" it back to a URL fetch.
- **`revalidatePath` is unreliable on the Workers/OpenNext runtime.** UI
  actions (Link, Queue, review) use **redirects** for guaranteed fresh
  state, anchored to the acted-on row (`#prop-<id>`) to preserve scroll.
  Don't switch these back to in-place revalidation — it silently shows
  stale data.
- **Cloudflare subrequest limit** (each DB upsert = 1 subrequest). GSC
  months can be 15k+ rows; batch size is 2000 to stay under the cap. On
  Workers Paid the wall-budget per sync invocation is 45s.
- **`ON CONFLICT` with a NULL column never matches** — the industry import
  uses check-then-insert for relationships (NULL `location_id`).
- **The dashboard "Last migration" tile stays empty** — it only tracks
  CLI/GitHub-applied migrations, and ours are applied by hand. The Table
  Editor is the truth.
- **Branded queries are excluded** from detectors (a site ranking for its
  own name isn't an opportunity) — see `isBrandedQuery` in
  `packages/scoring/src/detectors.ts`.
- **`position` is a reserved word** in Postgres `RETURNS TABLE` — it's
  quoted in the `gsc_*_totals` functions (migration 0007).

---

## 9. How to use the app (operator workflow)

1. Sign in at the app URL.
2. **Campaigns** (home) → an organisation holds campaigns; a campaign holds
   sites. Create as needed.
3. **Campaign page:** add sites, connect Google, link each GSC property to
   its site, queue backfills. Sync jobs table shows import progress.
4. **Explorer:** browse any site's queries/pages/dates; sortable columns.
   Permanent history (survives GSC's own 16-month limit).
5. **Opportunities:** priority-ranked feed with evidence + component scores.
   Accept (tracks outcome) or Dismiss. Auto-refreshes nightly.
6. **Entity graph:** the industry ontology with per-site query-demand
   coverage; approve/reject entities here.

Full UI reference: `docs/UI_SPEC.md`. Deployment facts: `docs/DEPLOYMENT.md`.

---

## 10. What's next (roadmap)

Not yet built: page manifests / coverage matrix (which page owns which
entity — the core topical-authority deliverable), network-wide detectors
(cross-site rollout patterns for the 99-site model), brief generation, and
production hardening (RBAC, audit everywhere). Full plan and phase
breakdown: `docs/ROADMAP.md`.
