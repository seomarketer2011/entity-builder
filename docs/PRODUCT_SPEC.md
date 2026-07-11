# Product Specification

## Problem

Service businesses (and networks of up to ~99 sites) need Google to see each
site — page by page — as the leading authority on its subject. Every page sits
at the intersection of an **industry**, a **service**, often a **customer
industry**, and a **location**. Naive approaches fail in two directions:

- keyword-stuffed pages that mention entities without explaining relationships;
- mass-generated service x industry x location pages that trip Google's
  scaled-content spam policies.

## What the product does

1. **Models the industry as a knowledge graph.** One master ontology per
   business industry (fire protection, locksmithing, crane hire…), with
   overlays for jurisdiction, customer industry, service, location, and each
   site's genuine capabilities and evidence.
2. **Scores every candidate entity** against weighted evidence tests before it
   can be assigned to a page (see ENTITY_SYSTEM.md).
3. **Assigns entity ownership to pages** via page manifests: primary entity,
   supporting entities, problems, commercial entities, required unique
   evidence, and — critically — an *excluded* list owned by other pages.
4. **Gates page creation** with eight deterministic tests so
   service–industry–location pages exist only where a materially distinct
   page is justified.
5. **Detects opportunities deterministically** from GSC + crawl + SERP data:
   CTR gaps, striking-distance rankings, unowned query clusters,
   cannibalisation, entity gaps, and network-wide rollout candidates. Every
   opportunity exposes its evidence.
6. **Produces content briefs** from manifests — never published pages.

## Who uses it

- The operator (initially a single internal user) managing campaigns that
  each contain one site or a network of sites.
- Multi-tenant from day one: organisations → campaigns → networks → sites.

## What the product deliberately does NOT do

- Publish or auto-generate live page content.
- Invent business capabilities a company does not have.
- Treat competitor content as validation (candidates only).
- Emulate a "Google topical authority score" — scores are internal editorial
  controls.
- Create pages for every keyword variation (Google understands synonyms;
  variations map to one canonical entity).

## Success criteria

- Every recommendation is explainable from stored evidence rows.
- A reviewer can trace any entity on any page back to its sources and score.
- Accepted opportunities are tracked to outcomes (clicks/impressions/position
  deltas) so the system's advice is itself measurable.
