# Entity System

## Principles

1. **Entity ≠ keyword.** Lexical variations ("fire door fitting",
   "fire-rated door installation") are aliases of one canonical entity, not
   separate entities.
2. **Relationships matter more than mentions.** The graph stores typed,
   evidenced relationships (installs, contains, requires, available_in…),
   because pages must *explain* how things relate, not list nouns.
3. **One master ontology per industry**, filtered per site by
   `business_capabilities`. A locksmith site never receives fire-alarm
   entities it cannot service.
4. **Business truth is the foundation.** Search data expands and organises
   what the business actually does; it never invents capabilities.

## Entity taxonomy

`industry_core`, `service`, `subservice_process`, `asset_component`,
`problem_defect`, `standard_regulation`, `customer_property`, `commercial`,
`location` — definitions and examples in DATA_MODEL.md.

## Candidate sources (in authority order)

1. **Business truth** — structured capability intake (services delivered/not
   delivered, equipment, qualifications, common jobs/defects, FAQs,
   rejection reasons).
2. **Authoritative documentation** — legislation, standards, trade bodies,
   manufacturer manuals. Outranks competitor content for validating
   technical relationships.
3. **Search demand** — GSC queries, autocomplete, People Also Ask, related
   searches, keyword datasets, Trends, ads queries, internal search, CRM
   wording.
4. **SERP corpus** — concepts recurring across genuinely relevant ranking
   pages and SERP features (not raw word frequency).
5. **First-party** — calls, enquiries, quotes, job reports, case studies.
6. **Competitor content** — discovery only. A competitor mention is a
   candidate, never validation.

## Discovery (implemented)

Finding entities that *should* connect to the graph but do not yet.
Implemented in `packages/entity-engine/src/entity-mining.ts` and
`packages/serp/src/dataforseo.ts`; proposals land in `entity_candidates`
(migration 0011) and are reviewed on the campaign Discovery screen.

Two sources, both feeding the same clustering and naming pipeline:

- **`gsc_demand`** — the site's own Search Console queries (last 90 days).
  Free, and every proposal carries real impressions as evidence.
- **`serp_competitor`** — keywords competing domains rank for, via the
  DataForSEO Labs API. Necessary because a site earns no impressions for
  topics it has no page for, so its own GSC data can never reveal that kind
  of gap. Metered and paid, therefore opt-in per run.

### Pipeline

1. **Exclude branded queries** — they describe the business, not what it
   offers.
2. **Split the location out** of each query using a vocabulary built from
   the operator's own data only: site names, `geographic_limit` capability
   records, and locations already in the graph. So "emergency locksmith
   croydon" and "emergency locksmith sutton" collapse to one service
   proposal carrying two locations, not two proposals. Multi-word places
   are matched longest-first ("west bromwich" beats "bromwich"), and a
   place name is only stripped on a whole-word boundary.
3. **Drop covered demand** — anything matching an existing entity or alias
   above `matchThreshold` token similarity is not a gap.
4. **Cluster** what remains (the same `clusterQueries` the
   `unowned_cluster` detector uses).
5. **Name each cluster** from the longest n-gram at least half its members
   share, rather than from its top query. A cluster named after its top
   query inherits that query's accidental specifics ("locked out of my car
   at night"); the shared phrase gives the general thing being asked for
   ("locked out of car").
6. **Suggest a type** from the wording — a suggestion the reviewer can
   change, never a decision.

### Constants (`ENTITY_MINING`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `minClusterImpressions` | 30 | Demand a cluster needs to be worth proposing |
| `minQueries` | 2 | Distinct queries required — no one-off proposals |
| `matchThreshold` | 0.6 | Token similarity above which demand counts as covered |
| `maxNameTokens` | 4 | Longest phrase considered when naming a cluster |
| `maxSampleQueries` | 8 | Sample queries carried as evidence per proposal |

### SERP cost control (`SERP_LIMITS`)

| Constant | Value |
| --- | --- |
| `maxRowsPerCall` | 200 |
| `maxCallsPerRun` | 12 |
| `maxCompetitors` | 5 |

The DataForSEO client counts every call against a per-run budget —
including failed ones, so a failing endpoint cannot be retried without
limit — and reports the API's own cost figure back to the caller, which the
UI surfaces after each run.

### Rules 1 and 3 in the discovery path

Candidates are **org-scoped staging**, never written into the shared
`entities` graph. Approval is what promotes one, and it records who decided.

Every candidate is assessed against the site's `business_capabilities`:

| Flag | Meaning |
| --- | --- |
| `capability match` | A `service_provided` or `common_job` record matches |
| `unverified` | No record matches — reviewer must confirm before approving |
| `not provided` | A `service_not_provided` record matches |

A `not provided` candidate **cannot be approved** — the API rejects it and
the UI disables the button. The system must never claim a business does
something it has explicitly said it does not.

## Extraction stack

LLM extraction (candidates + proposed relationships) → rule-based matching
for known industry terms/aliases → noun-phrase/n-gram extraction →
embedding-based clustering of similar terms → **human review**. Statistical
NER is imperfect on niche terms; nothing skips review.

## Normalisation

Every candidate resolves to: canonical name, entity type, aliases, subtypes
(as child entities with `subtype_of`), description, parent, related entities,
applicable services/industries/countries, evidence sources, approval status,
external identifier (Wikidata where one exists; most specialist commercial
concepts will be private-graph only).

## Validation scoring (0–100)

Implemented in `packages/scoring/src/entity-validator.ts`. Weights are fixed
here; changing them requires updating this file and the code together.

| Test | Weight | Question |
| --- | ---: | --- |
| Business truth | 25 | Does the company genuinely encounter/provide/work with this? |
| SERP evidence | 15 | Does it recur across relevant ranking pages/SERP features? |
| Search evidence | 15 | Present in GSC, keyword data, enquiries, or Trends? |
| Authoritative evidence | 15 | Supported by an official or technical source? |
| Relationship strength | 10 | Directly connected to the primary service? |
| Intent fit | 10 | Helps satisfy the intent of this particular page? |
| Commercial importance | 5 | Affects selection, cost, risk, or conversion? |
| Local relevance | 5 | Does location materially affect it? |

Bands: **75–100 required**, **55–74 supporting**, **35–54 optional**
(page-angle dependent), **<35 exclude**.

Automatic rejection regardless of score: the business does not provide it,
or the claimed relationship is factually inaccurate.

This is an internal editorial control — it does not claim to reproduce any
Google score.
