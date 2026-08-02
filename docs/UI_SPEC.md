# UI Specification

Dashboard (`apps/web`), organised per campaign. Six core entity-module
views plus the GSC explorer and opportunity feed.

## 1. Entity graph
Visual map of services, components, problems, standards, customer
industries, locations. Filter by entity type, status, score band, site.
Click-through to the evidence panel.

## 2. Entity evidence panel
Per entity: sources (typed, linked), matching queries, GSC impressions,
ranking-page appearances, related services/entities, component scores with
the total, approval status + reviewer, aliases and subtypes. Approve /
reject / merge-as-alias actions live here.

## 3. Page coverage matrix
Rows = entities, columns = pages (filterable to a service/industry/location
slice). Cells: required/supporting/optional/excluded/present-in-content.
Highlights: required-but-missing, present-but-excluded (cannibalisation
risk).

## 4. Cannibalisation view — implemented as the Conflicts page
Pages with substantially overlapping primary entities, intents, query sets,
or internal anchor text. Shows shared queries, both pages' GSC performance,
and the recommended resolution with its evidence.

**Implemented (`/campaigns/[id]/conflicts`).** Deliberately a *tracking*
surface, not an action picker: the operator applies fixes themselves, and
what the tool owes them is whether the fix worked. Per conflict — status
badge, first-seen date, days open, owner share with its change in points
since baseline, impressions with their change against baseline, and a
share-split trend with one bar per nightly run. Open and Resolved are
separate tabs so a fix can be confirmed to hold; regressions sort above
everything else. "Mark seen" records acknowledgement without touching the
measured status. Status rules: `docs/OPPORTUNITY_RULES.md`.

## 5. Location uniqueness score
Per location page: local evidence present, distinct queries, case studies,
operational info, unique customer/property context. Flags "rename-a-city"
template pages.

## 6. Opportunity feed
Sorted by priority score; each card shows component scores, evidence rows
(expandable to raw GSC data), recommended action, and accept/dismiss.
Accepted items get outcome tracking. Network-level opportunities show the
per-site rollout table.

## 7. Entity discovery — implemented
`/campaigns/[id]/discovery`. Three columns mirroring the graph's shape:
**main entities -> locations -> services & related**, so a reviewer can see
what a proposal would attach to before approving it. Each proposal card
carries its demand evidence (impressions, query count, best position,
expandable sample queries), a capability flag (`capability match` /
`unverified` / `not provided`), an editable name, and parent + predicate
pickers. Approve / Reject per row; `not provided` candidates cannot be
approved at all. Two run buttons — free demand mining, and competitor
mining which states that it spends API credit and reports what it spent.

## GSC explorer (Phase 1)
Property picker, date ranges, query/page/country/device dimensions,
compare-windows mode, sync status and job history.

**Query ownership.** The "By query" view shows the URL that actually earns
each query beneath the query itself, with a badge when two or more URLs
each take at least 25% of its impressions; the row expands to the full
per-URL split. The same cell renders in the campaign overview's top-queries
table. Long-tail URLs below the contender share never trigger the badge, so
it stays meaningful.

## General
- Every score in the UI is decomposable — click any number to see its
  components and inputs.
- Nothing auto-publishes; every state change (approve entity, accept
  opportunity, adopt manifest) is an explicit user action recorded in the
  audit log.
