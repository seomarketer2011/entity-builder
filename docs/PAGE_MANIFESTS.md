# Page Manifests & Page-Creation Gate

## Page architecture

Two meanings of "industry":

- **Business industry** → the site's overarching subject and service tree:
  `/fire-protection/`, `/fire-door-installation/`
- **Customer industry** → dedicated pages only where requirements genuinely
  differ: `/industries/care-homes/`
- **Locations**: `/locations/london/`, `/locations/croydon/`
- **Service–location**: `/locations/london/fire-door-installation/`
- **Industry–service–location**:
  `/industries/care-homes/london/fire-door-installation/` — only where all
  three dimensions produce a materially distinct page.

Never auto-generate services x industries x locations. Google's spam
policies explicitly target scaled unoriginal pages.

## Page-creation gate (8 tests)

Implemented in `packages/scoring/src/page-gate.ts`. A proposed page becomes
indexable only if **all** hard tests pass:

1. **Distinct intent** — users have a recognisably different need.
2. **Distinct service** — the offer or process changes.
3. **Distinct industry context** — the customer environment changes the work.
4. **Distinct local context** — location affects availability, property
   context, logistics, or evidence.
5. **Distinct evidence** — the company can provide local/industry-specific
   proof.
6. **Sufficient demand** — supported by GSC, SERPs, enquiries, or explicit
   strategic importance.
7. **No existing owner** — no current page already satisfies the intent.
8. **Commercial usefulness** — the page can realistically generate an
   appropriate enquiry.

Tests 2–4 apply only to the dimensions the proposed page actually varies on
(a service–location page isn't failed for lacking industry distinctiveness).
On failure, the recommendation is always **fold the content into the
strongest existing hub/service page**, with the failing tests listed.

## Manifest structure

Every indexable page gets a manifest (versioned in
`page_manifest_versions`):

- **Primary entity** (exactly one)
- **Location entity** (optional)
- **Customer-industry entity** (optional)
- **Required supporting entities** (score ≥ 75 for this page context)
- **Problems to address**
- **Commercial entities** (survey, quote, lead time, certification…)
- **Unique evidence required** (project, photos, qualifications, local
  logistics)
- **Excluded / owned by other pages** — prevents every page trying to own
  every topic; the primary anti-cannibalisation control.

## Location pages

Local relationships, not local word counts: genuine coverage, service
times/limits, local case studies, relevant building/customer types, real
photos, access considerations, local testimonials, local pricing variables.
Never manufacture differences (national regulations do not change by
borough). Landmark lists do not make a page local.

## Structured data

Mirrors the graph and confirms visible content only:

- Site level: `Organization`, genuine `LocalBusiness` subtype (real premises
  only), `WebSite`
- Service pages: `Service` + `provider` + `serviceType` + `areaServed`
  (+ `audience`, `offers` where genuine and visible), `BreadcrumbList`
- Service-area pages are `Service` with `areaServed` — **not** separate
  `LocalBusiness` entries unless a real branch exists.
- Guidance content: `Article` with author/reviewer and dates.

Markup never contains information hidden from users.
