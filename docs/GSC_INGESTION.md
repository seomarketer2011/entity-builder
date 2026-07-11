# GSC Ingestion

## Connection

Server-side Google OAuth web flow (established OAuth library, never
hand-rolled). Scopes: Search Console read-only. Refresh tokens encrypted at
rest with `TOKEN_ENCRYPTION_KEY`; never logged, never sent to the browser.

One `google_connection` can expose many `gsc_properties`; property discovery
via the Sites API. A property is linked to a `site` record before syncing.

## Sync strategy (must scale to 99+ properties)

1. **Backfill once** per property: up to 16 months of daily data.
2. **Incremental daily pulls** thereafter (GSC data lags ~2 days; pull
   date `today - 3` to be safe, re-pull the trailing 3 days to catch
   restatements).
3. Dimensions: `date, page, query, country, device` (+ `searchAppearance`
   later). `search_type=web` first; others later.
4. **Pagination**: 25,000-row pages via `startRow` until exhausted.
5. **Rate limits**: token bucket per property and per project; failed jobs
   retry with exponential backoff; a stuck property never blocks the queue.
6. **Idempotent upserts** keyed on
   `(property, date, page, query, country, device, search_type)` — re-running
   a day is always safe.
7. `gsc_sync_jobs` records every run: window, row counts, duration, errors.

## Storage

- Granular fact table `gsc_daily_query_page` (see DATA_MODEL.md). This is
  the evidence source for opportunity detectors — never store only
  aggregates.
- Materialised views for UI: per-page daily, per-query daily, site rollups.
  Refreshed after each sync batch.
- Anonymised query rows (GSC omits rare queries): store the aggregate
  clicks/impressions delta per page/day so totals reconcile.

## Data quality rules

- Never mix search types in one aggregate.
- Position is impression-weighted when aggregating.
- CTR is always recomputed from summed clicks/impressions, never averaged.
