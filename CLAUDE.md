# SEO Opportunity Engine (entity-builder)

> **New here? Read `docs/OPERATIONS.md` first.** It is the master
> handoff/operations note: live URLs, accounts, how the system runs itself,
> what's deployed, outstanding items, and known gotchas. Everything an
> operator or a fresh session needs to continue without guessing.

## Mission

Build a multi-tenant platform that imports Google Search Console and website
data, maintains verified industry entity graphs, assigns entity ownership to
pages via manifests, and produces explainable, evidence-backed SEO
opportunities for networks of service-business sites (industry x service x
location).

## Non-negotiable rules

1. Never invent business capabilities. A site only gets entities/services its
   `business_capabilities` records say it genuinely provides.
2. Every opportunity must carry evidence rows (`opportunity_evidence`).
3. AI-extracted entities and relationships are `proposed` until a human
   approves them. Nothing auto-promotes to `approved`.
4. No automatically generated page content is ever published by this system.
   It produces briefs and manifests, not live pages.
5. All schema changes go through `supabase/migrations/` (numbered, immutable
   once merged).
6. New behaviour requires tests. Scoring rules require table-driven tests.
7. Never commit secrets, tokens, or credentials. `.env.example` holds names only.
8. Preserve tenant isolation: every tenant-scoped query filters by
   organisation/campaign; RLS stays enabled on tenant tables.
9. Prefer deterministic calculations over LLM judgment. LLMs propose and
   explain; rules and humans decide.
10. Do not change scoring weights or gate thresholds without updating
    `docs/ENTITY_SYSTEM.md` / `docs/OPPORTUNITY_RULES.md` in the same PR —
    the constants in `packages/scoring` must match the docs.

## Layout

- `docs/` — source of truth for product, architecture, data model, rules.
- `supabase/migrations/` — Postgres schema (Supabase; pgvector + PostGIS later).
- `packages/domain` — shared TypeScript types mirroring the data model.
- `packages/scoring` — deterministic engines: entity validation score,
  page-creation gate, opportunity priority score. Pure functions, fully tested.
- `packages/entity-engine` — normalisation, alias handling, candidate pipeline,
  entity discovery mining (location splitting, clustering, cluster naming).
- `packages/serp` — DataForSEO Labs client (competitor domains, ranked
  keywords). Injected fetch, per-run call budget, fully tested.
- `packages/gsc` — Google OAuth, token crypto, Search Console client,
  sync planning/orchestration. Pure logic, injected fetch, fully tested.
- `packages/database` — pg pool, idempotent GSC upserts, sync-job repo.
- `apps/web` — Next.js dashboard. All data access via the user's Supabase
  session (RLS applies); never the service-role key.
- `apps/worker` — sync worker (service context; explicit scoping).
- `fixtures/` — realistic test data (fire-protection example graph).

## Before implementing an issue

1. Read the relevant files in `/docs` (at minimum PRODUCT_SPEC, DATA_MODEL,
   and the doc named in the issue).
2. Inspect existing migrations, types, and tests.
3. Produce an implementation plan; list files to create/modify.
4. Identify security, migration, and tenant-isolation risks.

## Definition of done

- Acceptance criteria satisfied
- `pnpm typecheck` passes
- `pnpm test` passes
- Documentation updated when behaviour or rules changed
- No secrets committed
- PR describes manual testing steps

## Commands

- `pnpm install` — install workspace deps
- `pnpm typecheck` — typecheck all packages
- `pnpm test` — run all tests (vitest)
