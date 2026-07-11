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

## 4. Cannibalisation view
Pages with substantially overlapping primary entities, intents, query sets,
or internal anchor text. Shows shared queries, both pages' GSC performance,
and the recommended resolution with its evidence.

## 5. Location uniqueness score
Per location page: local evidence present, distinct queries, case studies,
operational info, unique customer/property context. Flags "rename-a-city"
template pages.

## 6. Opportunity feed
Sorted by priority score; each card shows component scores, evidence rows
(expandable to raw GSC data), recommended action, and accept/dismiss.
Accepted items get outcome tracking. Network-level opportunities show the
per-site rollout table.

## GSC explorer (Phase 1)
Property picker, date ranges, query/page/country/device dimensions,
compare-windows mode, sync status and job history.

## General
- Every score in the UI is decomposable — click any number to see its
  components and inputs.
- Nothing auto-publishes; every state change (approve entity, accept
  opportunity, adopt manifest) is an explicit user action recorded in the
  audit log.
