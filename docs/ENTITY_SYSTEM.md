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
