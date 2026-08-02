import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { reviewCandidates, runDiscovery } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Discovery review: main entity → locations → services & related entities.
 *
 * The three columns mirror how the graph is actually shaped, so the
 * reviewer can see what a proposal would attach to before approving it.
 * Every row is a choice — approve, reject, rename, re-parent. Nothing on
 * this screen applies automatically.
 */

interface CandidateRow {
  id: string;
  discovery_source: string;
  suggested_name: string;
  suggested_type: string;
  suggested_parent_entity_id: string | null;
  suggested_predicate: string | null;
  location_name: string | null;
  impressions: number;
  clicks: number;
  best_position: number | null;
  query_count: number;
  sample_queries: Array<{ query: string; impressions: number; position: number | null }>;
  capability_supported: boolean | null;
  capability_note: string | null;
  status: string;
}

interface EntityOption {
  id: string;
  canonical_name: string;
  entity_type: string;
  status: string;
}

const PREDICATES = [
  "subtype_of",
  "installs",
  "inspects",
  "repairs",
  "contains",
  "component_of",
  "requires",
  "solves",
  "available_in",
  "serves",
  "performed_on",
];

const SOURCE_LABEL: Record<string, string> = {
  gsc_demand: "Search demand",
  serp_competitor: "Competitor",
};

function CapabilityFlag({ candidate }: { candidate: CandidateRow }) {
  if (candidate.capability_supported === false) {
    return (
      <span className="badge failed" title={candidate.capability_note ?? ""}>
        not provided
      </span>
    );
  }
  if (candidate.capability_supported === true) {
    return (
      <span className="badge succeeded" title={candidate.capability_note ?? ""}>
        capability match
      </span>
    );
  }
  return (
    <span className="badge running" title={candidate.capability_note ?? ""}>
      unverified
    </span>
  );
}

function CandidateCard({
  candidate,
  campaignId,
  siteId,
  industrySlug,
  entities,
}: {
  candidate: CandidateRow;
  campaignId: string;
  siteId: string;
  industrySlug: string;
  entities: EntityOption[];
}) {
  const blocked = candidate.capability_supported === false;
  return (
    <div
      className="card"
      style={{ marginBottom: "0.75rem", ...(blocked ? { opacity: 0.75 } : {}) }}
    >
      <form action={reviewCandidates} style={{ margin: 0 }}>
        <input type="hidden" name="campaignId" value={campaignId} />
        <input type="hidden" name="siteId" value={siteId} />
        <input type="hidden" name="industry" value={industrySlug} />
        <input type="hidden" name="candidateIds" value={candidate.id} />

        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            name={`name-${candidate.id}`}
            defaultValue={candidate.suggested_name}
            style={{ flex: "1 1 12rem", fontWeight: 600 }}
            aria-label="Entity name"
          />
          <span className="badge">{candidate.suggested_type}</span>
          <span className="badge">{SOURCE_LABEL[candidate.discovery_source] ?? candidate.discovery_source}</span>
          <CapabilityFlag candidate={candidate} />
        </div>

        <p className="evidence" style={{ margin: "0.4rem 0" }}>
          <strong>{Number(candidate.impressions).toLocaleString()}</strong> impressions ·{" "}
          {candidate.query_count} quer{candidate.query_count === 1 ? "y" : "ies"} ·{" "}
          best position{" "}
          {candidate.best_position == null ? "unranked" : Number(candidate.best_position).toFixed(1)}
          {candidate.location_name ? ` · ${candidate.location_name}` : ""}
        </p>

        {candidate.sample_queries?.length > 0 ? (
          <details>
            <summary className="evidence" style={{ cursor: "pointer" }}>
              Evidence — {candidate.sample_queries.length} sample quer
              {candidate.sample_queries.length === 1 ? "y" : "ies"}
            </summary>
            <ul className="evidence" style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
              {candidate.sample_queries.map((s) => (
                <li key={s.query}>
                  {s.query} — {Number(s.impressions).toLocaleString()} impressions
                  {s.position == null ? "" : `, position ${Number(s.position).toFixed(1)}`}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {candidate.capability_note ? (
          <p className="evidence" style={{ margin: "0.4rem 0" }}>
            {candidate.capability_note}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
          <select name={`parent-${candidate.id}`} defaultValue={candidate.suggested_parent_entity_id ?? ""} aria-label="Attach to">
            <option value="">— no parent —</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.canonical_name}
              </option>
            ))}
          </select>
          <select name={`predicate-${candidate.id}`} defaultValue={candidate.suggested_predicate ?? "subtype_of"} aria-label="Relationship">
            {PREDICATES.map((p) => (
              <option key={p} value={p}>
                {p.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button name="decision" value="approved" disabled={blocked}>
            Approve
          </button>
          <button name="decision" value="rejected" className="secondary">
            Reject
          </button>
        </div>
        {blocked ? (
          <p className="error" style={{ margin: "0.4rem 0 0" }}>
            Blocked: this site records it as not provided. Approving is disabled (rule 1).
          </p>
        ) : null}
        <p className="evidence" style={{ margin: "0.4rem 0 0" }}>
          The capability flag above is from the last discovery run. Approval re-checks the name you
          submit against this site&apos;s current capability records, so a rename can still be
          refused.
        </p>
      </form>
    </div>
  );
}

export default async function DiscoveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    site?: string;
    industry?: string;
    error?: string;
    notice?: string;
    show?: string;
  }>;
}) {
  const { id } = await params;
  const { site: siteParam, industry: industryParam, error, notice, show } = await searchParams;
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, sites(id, name, domain)")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  const siteId = siteParam ?? campaign.sites[0]?.id ?? "";
  const site = campaign.sites.find((s) => s.id === siteId);
  const showReviewed = show === "reviewed";

  let candidates: CandidateRow[] = [];
  let loadError: string | null = null;
  if (siteId) {
    const { data, error: queryError } = await supabase
      .from("entity_candidates")
      .select("*")
      .eq("site_id", siteId)
      .in("status", showReviewed ? ["approved", "rejected"] : ["candidate", "proposed"])
      .order("impressions", { ascending: false })
      .limit(300);
    if (queryError) loadError = queryError.message;
    candidates = (data ?? []) as CandidateRow[];
  }

  // Which industry graph this run is about. Coverage is judged against it
  // and approved candidates are created in it, so it is always explicit.
  const { data: industryRows } = await supabase.from("industries").select("id, slug, name").order("name");
  const industries = (industryRows ?? []) as Array<{ id: string; slug: string; name: string }>;
  const industry = industries.find((i) => i.slug === industryParam) ?? industries[0];

  // The graph a proposal can attach to, scoped to that industry
  // (industry_id IS NULL means cross-industry, so those belong too).
  const { data: entityRows } = industry
    ? await supabase
        .from("entities")
        .select("id, canonical_name, entity_type, status")
        .neq("status", "rejected")
        .or(`industry_id.eq.${industry.id},industry_id.is.null`)
        .order("canonical_name")
    : { data: [] };
  const entities = (entityRows ?? []) as EntityOption[];
  const coreEntities = entities.filter(
    (e) => e.entity_type === "industry_core" || e.entity_type === "service",
  );

  // Column 2: the locations this demand carries, aggregated.
  const locationTally = new Map<string, { impressions: number; count: number }>();
  for (const c of candidates) {
    if (!c.location_name) continue;
    const current = locationTally.get(c.location_name) ?? { impressions: 0, count: 0 };
    current.impressions += Number(c.impressions);
    current.count++;
    locationTally.set(c.location_name, current);
  }
  const locations = [...locationTally.entries()].sort(
    (a, b) => b[1].impressions - a[1].impressions,
  );

  // Column 3: everything else, split by whether it is a service.
  const services = candidates.filter((c) => c.suggested_type === "service");
  const related = candidates.filter((c) => c.suggested_type !== "service");
  const pendingIds = candidates.filter((c) => c.capability_supported !== false).map((c) => c.id);

  return (
    <div>
      <h1>Entity discovery — {campaign.name}</h1>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p style={{ color: "#15803d" }}>{notice}</p> : null}

      <form className="inline" method="get">
        <select name="site" defaultValue={siteId}>
          {campaign.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.domain})
            </option>
          ))}
        </select>
        <select name="industry" defaultValue={industry?.slug ?? ""}>
          {industries.map((i) => (
            <option key={i.id} value={i.slug}>
              {i.name}
            </option>
          ))}
        </select>
        <select name="show" defaultValue={showReviewed ? "reviewed" : "pending"}>
          <option value="pending">Pending review</option>
          <option value="reviewed">Already reviewed</option>
        </select>
        <button className="secondary">Show</button>
        <a className="button secondary" href={`/campaigns/${id}/entities`}>
          Entity graph
        </a>
        <a className="button secondary" href={`/campaigns/${id}`}>
          Back
        </a>
      </form>

      <div className="card">
        <form className="inline" action={runDiscovery} style={{ margin: 0 }}>
          <input type="hidden" name="campaignId" value={id} />
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="industry" value={industry?.slug ?? ""} />
          <button name="serp" value="0" disabled={!industry}>
            Find from search demand
          </button>
          <button name="serp" value="1" className="secondary">
            Also mine competitors (costs API credit)
          </button>
          <span className="muted">
            Demand mining is free and uses your own Search Console data. Competitor mining calls
            DataForSEO and spends from your account balance.
          </span>
        </form>
      </div>

      {loadError ? (
        <p className="error">{loadError} — apply migration 0011 (entity_candidates).</p>
      ) : null}

      {candidates.length === 0 ? (
        <div className="card">
          <p className="muted">
            {showReviewed
              ? "Nothing reviewed yet."
              : `No proposals for ${site?.name ?? "this site"} yet. Run discovery above — it looks for demand that no entity in the graph covers.`}
          </p>
        </div>
      ) : (
        <>
          {!showReviewed && pendingIds.length > 0 ? (
            <div className="card" style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
              <form action={reviewCandidates} className="inline" style={{ margin: 0 }}>
                <input type="hidden" name="campaignId" value={id} />
                <input type="hidden" name="siteId" value={siteId} />
                <input type="hidden" name="industry" value={industry?.slug ?? ""} />
                <input type="hidden" name="candidateIds" value={pendingIds.join(",")} />
                <strong>{candidates.length} proposals awaiting review.</strong>
                <button name="decision" value="rejected" className="secondary">
                  Reject all
                </button>
                <span className="muted">
                  Approve individually below — each one attaches to the graph where you choose.
                </span>
              </form>
            </div>
          ) : null}

          <div className="columns">
            <div>
              <h2>Main entities</h2>
              <div className="card">
                {coreEntities.length === 0 ? (
                  <p className="muted">
                    No approved services or industry core yet. Import and approve an industry
                    template on the Entity graph page first — proposals attach to these.
                  </p>
                ) : (
                  <>
                    <p className="muted" style={{ marginTop: 0 }}>
                      What the graph already owns. Proposals attach to one of these.
                    </p>
                    <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
                      {coreEntities.slice(0, 25).map((e) => (
                        <li key={e.id}>
                          {e.canonical_name}{" "}
                          <span className="badge">{e.status}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>

            <div>
              <h2>Locations</h2>
              <div className="card">
                {locations.length === 0 ? (
                  <p className="muted">
                    No location-qualified demand in these proposals. Locations are recognised from
                    your own site names, declared service areas and the locations already in the
                    graph.
                  </p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th className="num">Impressions</th>
                        <th className="num">Proposals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locations.map(([name, stats]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td className="num">{stats.impressions.toLocaleString()}</td>
                          <td className="num">{stats.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div>
              <h2>Services & related</h2>
              {services.length === 0 && related.length === 0 ? (
                <div className="card">
                  <p className="muted">Nothing proposed.</p>
                </div>
              ) : null}
              {services.length > 0 ? (
                <>
                  <p className="muted" style={{ margin: "0 0 0.4rem" }}>
                    {services.length} service proposal{services.length === 1 ? "" : "s"}
                  </p>
                  {services.map((c) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      campaignId={id}
                      siteId={siteId}
                      industrySlug={industry?.slug ?? ""}
                      entities={entities}
                    />
                  ))}
                </>
              ) : null}
              {related.length > 0 ? (
                <>
                  <p className="muted" style={{ margin: "0.6rem 0 0.4rem" }}>
                    {related.length} problem, commercial and regulation proposal
                    {related.length === 1 ? "" : "s"}
                  </p>
                  {related.map((c) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      campaignId={id}
                      siteId={siteId}
                      industrySlug={industry?.slug ?? ""}
                      entities={entities}
                    />
                  ))}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          <strong>How proposals are found.</strong> Demand mining strips the location out of every
          query using place names taken from your own sites, drops anything an existing entity or
          alias already covers, clusters what is left, and names each cluster after the longest
          phrase its queries share. Competitor mining does the same to the keywords rival domains
          rank for — demand you cannot see in your own Search Console because you have no page for
          it. Nothing here is applied automatically: every proposal needs your approval, and one
          your capability records mark as not provided cannot be approved at all.
        </p>
      </div>
    </div>
  );
}
