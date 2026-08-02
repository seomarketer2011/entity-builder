# Opportunity Rules

Detectors are deterministic and explainable. Every emitted opportunity
stores: the detector id, the input rows (`opportunity_evidence`), each
component score (`opportunity_scores`), and a plain-language explanation.
AI may narrate results; it never calculates the score.

## Detector V1 set

### 1. High impressions, weak CTR (`ctr_gap`) — implemented (V1)
Queries at average position ≤ 10 with ≥ 100 impressions in the 28-day
window whose CTR is below **50% of the expected CTR** for that position.
V1 expected-CTR curve (industry-average; per-site fitted curve is a
planned upgrade): pos 1: 28%, 2: 15%, 3: 11%, 4: 8%, 5: 7%, 6: 5%,
7: 4%, 8: 3%, 9: 2.5%, 10: 2.2%. Constants:
`packages/scoring/src/detectors.ts` (`CTR_GAP`, `EXPECTED_CTR`).
Recommendations: title/description alignment with dominant intent, missing
commercial qualifier, query–page mismatch fix.

### 2. Ranking within reach (`striking_distance`) — implemented (V1)
Queries averaging position **4–20** with **≥ 50 impressions** in the
window. Constants: `packages/scoring/src/detectors.ts`
(`STRIKING_DISTANCE`). Where a position 4–10 query also has a CTR gap,
`ctr_gap` wins and `striking_distance` is suppressed for that query.
Recommendations: improve page, add missing manifest section, strengthen
internal links, add evidence.

V1 analysis runs per site over the trailing 28 days of
`gsc_daily_query_page`; each run regenerates `status='open'` V1
opportunities (accepted/dismissed rows are never touched).

### 3. New-page opportunity (`unowned_cluster`)
A query cluster qualifies only when ALL hold: meaningful combined demand;
existing pages only partially satisfy it; intent differs from any owning
page; fits a genuine `business_capability`; has a clear architecture slot;
passes the page-creation gate.

### 4. Cannibalisation (`cannibalisation`)
Multiple URLs surfacing for substantially overlapping query clusters.
Resolutions (in evaluation order): consolidate, reassign intent, fix
internal linking, canonicalise, redirect, or keep both (genuinely distinct
intent).

### 5. Entity gap (`entity_gap`)
Page's manifest vs its visible content, queries, competitor coverage, and
authoritative sources. Output is relationship-shaped, never "mention phrase
X n times" — e.g. *"Explain how the closer is selected, installed, adjusted
and tested; this relationship is missing from the installation page."*

### 6. Network-wide opportunity (`network_rollout`)
Across a network: same cluster recurs; only a minority of sites have a
suitable page; sites with purpose-built pages measurably outperform; the
service genuinely applies network-wide. Output quantifies the gap (e.g. "74
of 99 sites lack a dedicated page; the 11 with one earn 3.4x the clicks for
this cluster").

### Implemented V2 thresholds (`packages/scoring/src/detectors-v2.ts`)

- `declining_page`: previous 28-day window ≥ 20 clicks AND current window
  below 70% of previous.
- `cannibalisation`: query with ≥ 50 impressions where ≥ 2 pages each take
  ≥ 25% of impressions. Findings are grouped by the set of competing pages
  — one finding per page conflict, listing every affected query variant,
  with priority driven by the conflict's combined impressions.
- `unowned_cluster`: lexical cluster (token Jaccard ≥ 0.5) with ≥ 2 member
  queries, ≥ 150 combined impressions, and best member position > 25 (or
  unranked). Branded queries excluded. Output is advisory: a new page must
  still pass the page-creation gate.

Still planned: `rising_query`, per-page attribution for `ctr_gap`.

## Query ownership

Every query in the Explorer and on the campaign overview is shown with the
URL that actually earns it — the page taking the most impressions for that
query in the window — via `gsc_query_owner_totals` (migration 0011). The
same rollup is available in TypeScript as `buildObservations()` in
`packages/scoring/src/conflict-lifecycle.ts`; the SQL and the TS agree by
construction, so the Explorer and the detectors can never disagree about
who owns a query.

A query is flagged as **contested** only when at least two URLs each hold
≥ 25% of its impressions (`CANNIBALISATION.minShare`). GSC reports a long
tail of URLs with a handful of impressions for nearly every query; badging
those would put a warning on almost every row and make the signal
worthless. A query with one page on 80% and two on 10% each is *not*
contested.

## Cannibalisation tracking (conflict lifecycle)

The `cannibalisation` detector says which pages compete *now*. The conflict
lifecycle answers the follow-up question — **is it getting better?** —
across successive nightly runs. Implemented in
`packages/scoring/src/conflict-lifecycle.ts`; stored in `query_conflicts`
and `query_conflict_snapshots` (migration 0011).

Conflicts are tracked per **(site, query)**, not per page-set. When a losing
page drops out, the page-set changes but the query does not — keying on the
query is what distinguishes "this conflict resolved" from "a different
conflict appeared".

### Constants (`CONFLICT_LIFECYCLE`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `minQueryImpressions` | 50 | Noise floor before a query is tracked at all |
| `minShare` | 0.25 | Impression share at which a page counts as a contender |
| `resolvedOwnerShare` | 0.75 | Owner share that must be **exceeded** to resolve |
| `impressionRetention` | 0.85 | Fraction of baseline impressions that must survive |
| `improvingShareGain` | 0.10 | Owner share gain (points/100) counting as improvement |

### Baseline

Every comparison is made against the state captured at **first detection**,
never against the previous run. Measuring run-over-run would let a slow
multi-week decline read as a series of small improvements.

### Measurement must use complete page sets

`gsc_query_page_totals` is globally ordered and row-capped, so it is only
safe for **discovering** newly contested queries. It must never be used to
measure one already being tracked: on a large site that query may fall
outside the cap, or have only some of its pages survive it, and zero rows
is indistinguishable from zero impressions. Reading that as lost demand
would write a permanent, wrong `collapsed` snapshot.

Tracking therefore re-reads exact rows for the tracked queries through
`gsc_query_page_totals_for_queries` (bounded by the number of conflicts,
not a global cap). If that function is unavailable the run **fails loudly**
rather than guessing — history is append-only and a wrong snapshot cannot
be taken back.

### Statuses, in evaluation order

| # | Status | Fires when |
| --- | --- | --- |
| 1 | `new` | First sighting. This run becomes the baseline. |
| 2 | `regressed` | Was `resolved`, and ≥ 2 pages are contesting it again. |
| 3 | `resolved` | Owner share > 75% **and** impressions ≥ 85% of baseline. |
| 4 | `collapsed` | Owner share > 75% **but** impressions fell below 85% of baseline. |
| 5 | `collapsed` | Contention gone **and** impressions fell below 85% of baseline. |
| 6 | `improving` | Contention gone, demand retained, owner not yet above 75%. |
| 7 | `improving` | Still contested, but contenders fell or owner share rose ≥ 10 points, with demand retained. |
| 8 | `ongoing` | Anything else — still contested, no material change. |

### Why `collapsed` exists

Contention disappearing is **not** automatically a win. If the competing
pages stopped showing because the query lost its demand, that is a loss
wearing a win's clothes. Rules 4 and 5 above catch exactly that case and
report it as `collapsed`, which is deliberately not styled as a success in
the UI. This is the single most important distinction in the lifecycle: a
naive "contender count dropped to 1" rule would call a traffic collapse a
fix.

### Operator state

`acknowledged_at` records that a human has seen a conflict. It deliberately
does **not** change the measured status — the engine owns status, derived
from data alone. Acknowledging only silences the "new" highlight.

Resolved conflicts move to a separate tab rather than vanishing, so a fix
can be confirmed to hold and a regression is visible when it happens.
Regressions sort above everything else in the open list: a fix that stopped
holding matters more than something never looked at.

## Priority score

Implemented in `packages/scoring/src/opportunity-score.ts`. Components are
each 0–100 and independently stored/visible:

- traffic potential
- confidence (evidence quality/quantity)
- commercial value
- page relevance
- strategic fit
- implementation ease
- network applicability (1 site = low, whole network = high)

Overall priority = weighted geometric mean (weights in code and kept in sync
with this doc). Geometric, so a near-zero component (e.g. business does not
provide the service → strategic fit ≈ 0) sinks the whole score rather than
being averaged away.

| Component | Weight |
| --- | ---: |
| Traffic potential | 20 |
| Confidence | 20 |
| Commercial value | 20 |
| Page relevance | 15 |
| Strategic fit | 10 |
| Implementation ease | 10 |
| Network applicability | 5 |

## Outcome tracking

Accepted opportunities record a baseline window; after implementation, the
system measures click/impression/position deltas over comparable windows
(`opportunity_outcomes`), so detector quality is itself measurable.
