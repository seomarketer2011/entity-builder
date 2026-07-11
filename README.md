# Entity Builder — SEO Opportunity Engine

A platform for building **topical authority the honest way**: instead of asking
"which words must this page contain?", it models **which entities and
relationships each page must explain, what evidence proves them, and why the
page should exist at all** — then measures where sites underperform against
that assignment using Google Search Console and SERP data.

Built for service businesses where every page sits at the intersection of an
**industry** (fire protection, locksmithing, crane hire…), a **service**
(installation, inspection, repair…), a **customer industry** (care homes,
hotels, HMOs…) and a **location** — including networks of many sites.

## Core ideas

1. **One master industry ontology per industry**, filtered per site by genuine
   business capabilities. Entities are canonical concepts with aliases,
   types, parents, relationships, and evidence — not keyword lists.
2. **Every entity is scored 0–100** against eight weighted evidence tests
   (business truth, SERP, search demand, authoritative sources, relationship
   strength, intent fit, commercial importance, local relevance) before it can
   be required on a page. See `docs/ENTITY_SYSTEM.md`.
3. **Pages earn the right to exist** through an 8-test page-creation gate
   (distinct intent, distinct service, distinct industry context, distinct
   local context, distinct evidence, sufficient demand, no existing owner,
   commercial usefulness). Failing combinations fold into hubs instead of
   spawning thin URLs. See `docs/PAGE_MANIFESTS.md`.
4. **Opportunities are deterministic and explainable.** Every recommendation
   exposes the GSC rows and rules that produced it. AI explains; it does not
   secretly score. See `docs/OPPORTUNITY_RULES.md`.

## Repository structure

| Path | Purpose |
| --- | --- |
| `docs/` | Product spec, architecture, data model, rules — the source of truth |
| `supabase/migrations/` | Postgres schema (multi-tenant, RLS) |
| `packages/domain` | Shared TypeScript domain types |
| `packages/scoring` | Deterministic scoring engines + tests |
| `packages/entity-engine` | Entity normalisation & candidate pipeline |
| `apps/web` | Next.js dashboard (Phase 1) |
| `apps/worker` | GSC ingestion & analysis worker (Phase 1) |
| `fixtures/` | Realistic example data (fire-protection graph) |

## Getting started

```bash
pnpm install
pnpm typecheck
pnpm test
```

Database: apply `supabase/migrations/*.sql` in order to a Postgres 15+ /
Supabase instance.

## Build phases

See `docs/ROADMAP.md`. Current status: **Phase 1 code complete** — auth,
tenancy CRUD, Google OAuth with encrypted token storage, resumable GSC
backfill + incremental sync worker, sync dashboard, and GSC explorer.
Cloud configuration steps are in `docs/SETUP.md`. Next: Phase 2
(deterministic opportunity detectors).
