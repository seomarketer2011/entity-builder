import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { reviewOpportunity, runAnalysis } from "./actions";

export const dynamic = "force-dynamic";

interface OpportunityRow {
  id: string;
  site_id: string;
  type: string;
  title: string;
  explanation: string;
  recommended_action: string;
  status: string;
  priority: number;
  opportunity_scores: {
    traffic_potential: number;
    confidence: number;
    commercial_value: number;
    page_relevance: number;
    strategic_fit: number;
    implementation_ease: number;
    network_applicability: number;
  } | null;
  opportunity_evidence: Array<{ kind: string; payload: unknown }>;
}

const TYPE_LABELS: Record<string, string> = {
  ctr_gap: "Weak CTR",
  striking_distance: "Within reach",
  declining_page: "Declining",
  cannibalisation: "Cannibalisation",
  unowned_cluster: "Unowned demand",
};

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string; site?: string }>;
}) {
  const { id } = await params;
  const { error, notice, site } = await searchParams;
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, sites(id, name)")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  let query = supabase
    .from("opportunities")
    .select(
      "id, site_id, type, title, explanation, recommended_action, status, priority, opportunity_scores(*), opportunity_evidence(kind, payload)",
    )
    .eq("campaign_id", id)
    .eq("status", "open")
    .order("priority", { ascending: false })
    .limit(100);
  if (site) query = query.eq("site_id", site);
  const { data: opportunities } = await query;

  const siteName = new Map(campaign.sites.map((s) => [s.id, s.name]));

  return (
    <div>
      <h1>Opportunities — {campaign.name}</h1>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p style={{ color: "#15803d" }}>{notice}</p> : null}

      <form className="inline" action={runAnalysis}>
        <input type="hidden" name="campaignId" value={id} />
        <button>Run analysis now</button>
        <a className="button secondary" href={`/campaigns/${id}`}>
          Back to campaign
        </a>
        <span className="muted">
          Analyses the last 28 days of every site in this campaign. Also runs automatically
          each morning after the data sync.
        </span>
      </form>

      {(opportunities ?? []).length === 0 ? (
        <div className="card">
          <p className="muted">
            No open opportunities. Either run the analysis above, or the sites genuinely have
            nothing flagged (young sites with little data produce few findings).
          </p>
        </div>
      ) : (
        (opportunities ?? []).map((o) => {
          const opp = o as unknown as OpportunityRow;
          const s = opp.opportunity_scores;
          return (
            <div className="card" key={opp.id}>
              <p style={{ margin: 0 }}>
                <span className="badge">{TYPE_LABELS[opp.type] ?? opp.type}</span>{" "}
                <span className="badge">{siteName.get(opp.site_id) ?? "site"}</span>{" "}
                <strong style={{ marginLeft: "0.3rem" }}>{opp.title}</strong>
                <span style={{ float: "right", fontWeight: 700, color: "var(--accent)" }}>
                  {Number(opp.priority).toFixed(0)}/100
                </span>
              </p>
              <p>{opp.explanation}</p>
              <p>
                <strong>Do this:</strong> {opp.recommended_action}
              </p>
              {s ? (
                <p className="muted" style={{ fontSize: "0.8rem" }}>
                  traffic {Number(s.traffic_potential).toFixed(0)} · confidence{" "}
                  {Number(s.confidence).toFixed(0)} · commercial {Number(s.commercial_value).toFixed(0)} ·
                  relevance {Number(s.page_relevance).toFixed(0)} · fit{" "}
                  {Number(s.strategic_fit).toFixed(0)} · ease {Number(s.implementation_ease).toFixed(0)}
                </p>
              ) : null}
              <details>
                <summary className="muted">Evidence</summary>
                <pre style={{ overflow: "auto", fontSize: "0.75rem" }}>
                  {JSON.stringify(opp.opportunity_evidence, null, 2)}
                </pre>
              </details>
              <form className="inline" action={reviewOpportunity} style={{ marginBottom: 0 }}>
                <input type="hidden" name="campaignId" value={id} />
                <input type="hidden" name="opportunityId" value={opp.id} />
                <button name="decision" value="accepted">
                  Accept — I'll action this
                </button>
                <button name="decision" value="dismissed" className="secondary">
                  Dismiss
                </button>
              </form>
            </div>
          );
        })
      )}
    </div>
  );
}
