import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { importIndustry, reviewEntities } from "./actions";

export const dynamic = "force-dynamic";

interface EntityRow {
  id: string;
  canonical_name: string;
  entity_type: string;
  status: string;
  entity_aliases: Array<{ alias: string }>;
}

interface QueryTotal {
  query: string;
  clicks: number;
  impressions: number;
  position: number | null;
}

const TYPE_ORDER = [
  "service",
  "problem_defect",
  "asset_component",
  "commercial",
  "customer_property",
  "standard_regulation",
  "subservice_process",
  "industry_core",
  "location",
];

const TYPE_LABELS: Record<string, string> = {
  service: "Services",
  problem_defect: "Problems customers search for",
  asset_component: "Assets & components",
  commercial: "Commercial signals",
  customer_property: "Customer types",
  standard_regulation: "Standards & regulations",
  subservice_process: "Process steps",
  industry_core: "Industry core",
  location: "Locations",
};

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Demand for an entity on a site: query rows matching name or any alias. */
function matchDemand(entity: EntityRow, queries: QueryTotal[]) {
  const needles = [entity.canonical_name, ...entity.entity_aliases.map((a) => a.alias)]
    .map(normalise)
    .filter((n) => n.length >= 4);
  let impressions = 0;
  let best: number | null = null;
  let matched = 0;
  for (const q of queries) {
    const nq = normalise(q.query);
    if (needles.some((n) => nq.includes(n))) {
      matched++;
      impressions += q.impressions;
      if (q.position != null) best = best == null ? q.position : Math.min(best, q.position);
    }
  }
  return { matched, impressions, best };
}

export default async function EntitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string; site?: string; industry?: string }>;
}) {
  const { id } = await params;
  const { error, notice, site: siteParam, industry: industryParam } = await searchParams;
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, sites(id, name, domain)")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  const { data: industries } = await supabase.from("industries").select("id, slug, name").order("name");
  const industry =
    (industries ?? []).find((i) => i.slug === industryParam) ?? (industries ?? [])[0];

  const siteId = siteParam ?? campaign.sites[0]?.id;
  const site = campaign.sites.find((s) => s.id === siteId);

  let entities: EntityRow[] = [];
  if (industry) {
    const { data } = await supabase
      .from("entities")
      .select("id, canonical_name, entity_type, status, entity_aliases(alias)")
      .eq("industry_id", industry.id)
      .neq("status", "rejected")
      .order("canonical_name");
    entities = (data ?? []) as EntityRow[];
  }

  // Site query demand for coverage matching (last 90 days).
  let queries: QueryTotal[] = [];
  if (site) {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const { data } = await supabase.rpc("gsc_query_totals", {
      p_site_id: site.id,
      p_from: from,
      p_to: today,
      p_limit: 1000,
    });
    queries = (data ?? []) as QueryTotal[];
  }

  const proposedIds = entities.filter((e) => e.status === "proposed").map((e) => e.id);
  const grouped = new Map<string, EntityRow[]>();
  for (const e of entities) {
    const list = grouped.get(e.entity_type) ?? [];
    list.push(e);
    grouped.set(e.entity_type, list);
  }

  return (
    <div>
      <h1>Entity graph — {campaign.name}</h1>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p style={{ color: "#15803d" }}>{notice}</p> : null}

      <form className="inline" method="get">
        <select name="industry" defaultValue={industry?.slug ?? ""}>
          {(industries ?? []).map((i) => (
            <option key={i.id} value={i.slug}>
              {i.name}
            </option>
          ))}
        </select>
        <select name="site" defaultValue={siteId ?? ""}>
          {campaign.sites.map((s) => (
            <option key={s.id} value={s.id}>
              Coverage vs: {s.name}
            </option>
          ))}
        </select>
        <button className="secondary">Apply</button>
        <a className="button secondary" href={`/campaigns/${id}`}>
          Back
        </a>
      </form>

      {(industries ?? []).length === 0 ? (
        <div className="card">
          <p className="muted">
            No industry graphs imported yet. Import the curated locksmith template to begin:
          </p>
          <form className="inline" action={importIndustry}>
            <input type="hidden" name="campaignId" value={id} />
            <select name="industry" defaultValue="locksmith-services">
              <option value="locksmith-services">Locksmith services</option>
              <option value="fire-protection">Fire protection</option>
            </select>
            <button>Import industry template</button>
          </form>
        </div>
      ) : (
        <>
          {proposedIds.length > 0 ? (
            <div className="card" style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
              <form className="inline" action={reviewEntities} style={{ margin: 0 }}>
                <input type="hidden" name="campaignId" value={id} />
                <input type="hidden" name="entityIds" value={proposedIds.join(",")} />
                <strong>{proposedIds.length} entities await review.</strong>
                <button name="decision" value="approved">
                  Approve all
                </button>
                <span className="muted">
                  Approve only what these businesses genuinely provide — reject per row below.
                </span>
              </form>
            </div>
          ) : null}

          {TYPE_ORDER.filter((t) => grouped.has(t)).map((type) => (
            <div key={type}>
              <h2>{TYPE_LABELS[type] ?? type}</h2>
              <div className="card">
                <table>
                  <thead>
                    <tr>
                      <th>Entity</th>
                      <th>Aliases</th>
                      <th>Status</th>
                      <th className="num">Demand ({site?.name ?? "site"})</th>
                      <th className="num">Best pos</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.get(type)!.map((e) => {
                      const demand = matchDemand(e, queries);
                      return (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.canonical_name}</strong>
                          </td>
                          <td className="muted" style={{ maxWidth: "18rem" }}>
                            {e.entity_aliases.map((a) => a.alias).join(", ")}
                          </td>
                          <td>
                            <span className={`badge ${e.status === "approved" ? "succeeded" : "running"}`}>
                              {e.status}
                            </span>
                          </td>
                          <td className="num">
                            {demand.impressions > 0 ? (
                              <strong>{demand.impressions.toLocaleString()}</strong>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="num">{demand.best != null ? demand.best.toFixed(1) : "—"}</td>
                          <td>
                            {e.status === "proposed" ? (
                              <form action={reviewEntities} style={{ margin: 0, display: "inline" }}>
                                <input type="hidden" name="campaignId" value={id} />
                                <input type="hidden" name="entityIds" value={e.id} />
                                <button name="decision" value="rejected" className="secondary">
                                  Reject
                                </button>
                              </form>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="muted">
            <strong>Demand</strong> = impressions on {site?.name ?? "the site"} in the last 90
            days for queries matching the entity or its aliases. High demand + poor best
            position = the entity gap to fix first.
          </p>
        </>
      )}
    </div>
  );
}
