# Opportunity Rules

Detectors are deterministic and explainable. Every emitted opportunity
stores: the detector id, the input rows (`opportunity_evidence`), each
component score (`opportunity_scores`), and a plain-language explanation.
AI may narrate results; it never calculates the score.

## Detector V1 set

### 1. High impressions, weak CTR (`ctr_gap`)
Query/page pairs with substantial impressions whose CTR falls below the
expected CTR for their average position (expected-CTR curve computed per
site from its own GSC data, falling back to network-level curve).
Recommendations: title/description alignment with dominant intent, missing
commercial qualifier, query–page mismatch fix.

### 2. Ranking within reach (`striking_distance`)
Queries averaging position 4–20 with sufficient impressions and strong page
relevance. Recommendations: improve page, add missing manifest section,
strengthen internal links, add evidence.

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

Also in V1: `declining_page`, `rising_query` (trend deltas over rolling
windows).

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
