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
