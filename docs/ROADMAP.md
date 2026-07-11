# Roadmap & Backlog

Work proceeds one phase at a time; each numbered item is intended to become
a GitHub issue. Definition of done in CLAUDE.md applies to all.

## Phase 0 — Foundation (this repo scaffold) ✅
- [x] Docs as source of truth
- [x] Database schema migrations (tenancy, capabilities, GSC, crawl, entity
      graph, manifests, opportunities)
- [x] `packages/domain` types
- [x] `packages/scoring`: entity validator, page gate, opportunity priority
      (pure + tested)
- [x] `packages/entity-engine`: normalisation + alias candidate detection
      (pure + tested)
- [x] Fire-protection fixture graph
- [x] CI (typecheck + tests)

## Phase 1 — Auth & GSC ingestion (code complete ✅ — cloud setup per docs/SETUP.md)
1. [x] Migrations + RLS policies + policy tests (`supabase/tests/rls_test.sql`)
2. [x] Auth (Supabase auth), organisations/campaigns/sites CRUD
       (networks CRUD UI deferred to Phase 4 where networks first matter)
3. [x] Google OAuth connect flow; AES-256-GCM token store; property discovery
4. [x] Backfill job (16 months, monthly windows, paginated) + incremental
       sync with 3-day re-pull (`packages/gsc`, `apps/worker`)
5. [x] Sync job dashboard (status, errors, row counts)
6. [x] GSC explorer (query/page/date, RLS-safe SECURITY INVOKER aggregates)
7. [x] Materialised views + refresh function; scheduling via pg_cron
       (docs/SETUP.md §7 — in-app scheduler as Phase 2 follow-up)

## Phase 2 — Opportunity Engine V1 (deterministic detectors)
8. Expected-CTR curve per site; `ctr_gap` detector
9. `striking_distance` detector
10. Query clustering (embeddings + rules) and cluster ownership
11. `unowned_cluster`, `declining_page`, `rising_query`
12. Basic `cannibalisation`
13. Opportunity feed UI with evidence drill-down

## Phase 3 — Entity system
14. Capability intake form → `business_capabilities`
15. Industry template import (fixtures → shared master graphs)
16. Candidate extraction pipeline (LLM + rules + n-grams) into `entity_candidates`
17. Alias/normalisation review queue (uses entity-engine similarity)
18. Entity scoring runs + evidence panel UI
19. Approval workflow + audit log
20. Page manifests + coverage matrix UI; `entity_gap` detector

## Phase 4 — Site & network intelligence
21. Crawler (pages, headings, links, schema) into page inventory
22. Multi-site comparison; network query clusters
23. Winning-page pattern analysis; `network_rollout` detector
24. Duplicate/near-duplicate page detection (pgvector)
25. Location uniqueness score

## Phase 5 — Brief generation
26. Brief builder from manifest (intent, entities, relationships, queries,
    evidence requirements, internal links, exclusions, validation checklist)
27. Export (markdown/PDF) + brief versioning

## Phase 6 — Production hardening
28. RBAC, audit logs everywhere, retryable job framework, rate-limit
    handling, usage monitoring, backups, staging env, provider cost
    controls, data retention
