# Architecture

## System shape

```text
Google Search Console ─┐
Website crawls ────────┤
SERP/keyword provider ─┤
Capability intake ─────┼──▶ apps/worker (ingestion & analysis jobs)
Official sources ──────┤          │
CRM/enquiry imports ───┘          ▼
                        Supabase / PostgreSQL
                         ├─ raw imports          ├─ entity graph + evidence
                         ├─ normalised GSC data  ├─ page manifests
                         ├─ pages & clusters     ├─ opportunities
                                  │
                                  ▼
                        packages/scoring (deterministic engines)
                                  │
                                  ▼
                        apps/web (Next.js dashboard + API)
```

## Stack

- **TypeScript throughout.** No Python in the MVP; add a Python NLP service
  later only if it demonstrably improves extraction.
- **Next.js** (`apps/web`) — dashboard + API routes.
- **Node worker** (`apps/worker`) — GSC imports, crawling, SERP fetches,
  analysis jobs. Queue-driven, retryable, idempotent.
- **Supabase/Postgres** — source of truth. Extensions: `pgvector` (semantic
  similarity: alias detection, cluster similarity, page-duplication checks),
  `PostGIS` (location relationships), `pg_cron` (scheduled syncs).
- **GitHub Actions** — typecheck + tests on every PR.

## Package boundaries

| Package | Responsibility | May depend on |
| --- | --- | --- |
| `packages/domain` | Types + enums mirroring DATA_MODEL.md | nothing |
| `packages/scoring` | Pure deterministic scoring/gating functions | domain |
| `packages/entity-engine` | Normalisation, alias logic, candidate pipeline | domain, scoring |
| `packages/database` (Phase 1) | DB client, queries, RLS-safe helpers | domain |
| `apps/worker` | Jobs and connectors | all packages |
| `apps/web` | UI + API | all packages |

Rules of thumb:

- Scoring functions are **pure**: inputs in, score + explanation out. No IO.
- Connectors never write directly to verified tables — imports land in raw
  tables; promotion into the graph goes through validation + review.
- Embeddings assist similarity questions; the canonical taxonomy lives in
  relational tables, never only in vectors.

## Key flows

**GSC ingestion** — see GSC_INGESTION.md. Backfill once (16 months), then
incremental daily pulls per property; store granular
date/page/query/country/device rows; materialised views for UI aggregates.

**Entity pipeline** — sources → candidate extraction (LLM + rules + n-grams)
→ normalisation (canonical + aliases) → scoring → human review → approved
graph. See ENTITY_SYSTEM.md.

**Opportunity run** — scheduled analysis over normalised GSC + crawl + graph;
each detector emits opportunities with evidence and component scores. See
OPPORTUNITY_RULES.md.
