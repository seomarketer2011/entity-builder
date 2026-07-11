# apps/worker

Node worker for GSC ingestion, crawling, SERP fetches, and analysis jobs.
Implemented in **Phase 1** (see `docs/ROADMAP.md`, `docs/GSC_INGESTION.md`,
`docs/ARCHITECTURE.md`). Connectors write to raw tables only; promotion into
the verified graph goes through validation + review.
