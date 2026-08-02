import { notFound, redirect } from "next/navigation";
import { CONFLICT_LIFECYCLE, type QueryConflictStatus } from "@entity-builder/scoring";
import { prettyUrl } from "@/components/query-owner";
import { requireUser } from "@/lib/supabase/server";
import { acknowledgeConflict } from "./actions";

export const dynamic = "force-dynamic";

interface ConflictRow {
  id: string;
  query: string;
  status: QueryConflictStatus;
  owner_page: string | null;
  owner_share: number | null;
  contender_count: number;
  total_impressions: number;
  total_clicks: number;
  best_position: number | null;
  baseline_impressions: number;
  baseline_owner_share: number | null;
  baseline_contender_count: number;
  peak_contender_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  regressed_at: string | null;
  acknowledged_at: string | null;
  note: string | null;
}

interface SnapshotRow {
  conflict_id: string;
  captured_on: string;
  status: QueryConflictStatus;
  owner_share: number | null;
  contender_count: number;
  total_impressions: number;
  contenders: Array<{ page: string; impressions: number; share: number; position: number | null }>;
}

const OPEN_STATUSES: QueryConflictStatus[] = [
  "regressed",
  "new",
  "ongoing",
  "improving",
  "collapsed",
];

/** Regressions first — a conflict you already fixed coming back matters
 *  more than one you have never looked at. */
const STATUS_RANK: Record<QueryConflictStatus, number> = {
  regressed: 0,
  new: 1,
  ongoing: 2,
  improving: 3,
  collapsed: 4,
  resolved: 5,
};

const STATUS_LABEL: Record<QueryConflictStatus, string> = {
  new: "New",
  ongoing: "Ongoing",
  improving: "Improving",
  resolved: "Resolved",
  collapsed: "Collapsed",
  regressed: "Regressed",
};

const STATUS_HELP: Record<QueryConflictStatus, string> = {
  new: "Just detected. This run is the baseline everything later is measured against.",
  ongoing: "Still split across competing URLs, with no material change yet.",
  improving: "Moving the right way — fewer contenders or a bigger share for the owner.",
  resolved: `One URL now holds more than ${Math.round(CONFLICT_LIFECYCLE.resolvedOwnerShare * 100)}% of the query and the demand held up.`,
  collapsed:
    "The competing URLs stopped showing, but the query lost impressions — the contention went because the demand went, not because it was fixed.",
  regressed: "This was resolved and is contested again.",
};

function daysBetween(from: string, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 86400000));
}

function fmtShare(share: number | null): string {
  return share == null ? "—" : `${Math.round(share * 100)}%`;
}

function fmtDate(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "—";
}

/**
 * Share-split trend: one bar per analysis run, filled to the owner's share
 * of the query. A rising fill means the owner is consolidating; the grey
 * remainder is what the competing URLs still take.
 */
function Trend({ snapshots }: { snapshots: SnapshotRow[] }) {
  if (snapshots.length === 0) return <span className="muted">—</span>;
  const shown = snapshots.slice(-14);
  return (
    <span className="trend">
      {shown.map((s) => {
        const share = s.owner_share == null ? 0 : Number(s.owner_share);
        return (
          <span
            key={s.captured_on}
            className="trend-bar"
            style={{ height: "1.6rem" }}
            title={`${s.captured_on}: owner ${Math.round(share * 100)}%, ${s.contender_count} contender${s.contender_count === 1 ? "" : "s"}, ${Number(s.total_impressions).toLocaleString()} impressions`}
          >
            <span style={{ height: `${Math.round(share * 100)}%` }} />
          </span>
        );
      })}
    </span>
  );
}

export default async function ConflictsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ site?: string; tab?: string; q?: string }>;
}) {
  const { id } = await params;
  const { site: siteParam, tab: tabParam, q } = await searchParams;
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, sites(id, name, domain)")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  const siteId = siteParam ?? campaign.sites[0]?.id;
  const site = campaign.sites.find((s) => s.id === siteId);
  const tab = tabParam === "resolved" ? "resolved" : "open";

  let conflicts: ConflictRow[] = [];
  let loadError: string | null = null;
  if (siteId) {
    let request = supabase
      .from("query_conflicts")
      .select("*")
      .eq("site_id", siteId)
      .in("status", tab === "resolved" ? ["resolved"] : OPEN_STATUSES)
      .order("total_impressions", { ascending: false })
      .limit(200);
    if (q) request = request.eq("query", q);
    const { data, error } = await request;
    if (error) loadError = error.message;
    conflicts = (data ?? []) as ConflictRow[];
  }

  conflicts.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      Number(b.total_impressions) - Number(a.total_impressions),
  );

  const snapshotsByConflict = new Map<string, SnapshotRow[]>();
  if (conflicts.length > 0) {
    const { data } = await supabase
      .from("query_conflict_snapshots")
      .select(
        "conflict_id, captured_on, status, owner_share, contender_count, total_impressions, contenders",
      )
      .in(
        "conflict_id",
        conflicts.map((c) => c.id),
      )
      .order("captured_on", { ascending: true });
    for (const row of (data ?? []) as SnapshotRow[]) {
      const list = snapshotsByConflict.get(row.conflict_id) ?? [];
      list.push(row);
      snapshotsByConflict.set(row.conflict_id, list);
    }
  }

  const now = new Date();
  const regressed = conflicts.filter((c) => c.status === "regressed");
  const tabHref = (next: string) =>
    `/campaigns/${id}/conflicts?site=${siteId ?? ""}&tab=${next}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div>
      <h1>Competing URLs — {campaign.name}</h1>

      <form className="inline" method="get">
        <input type="hidden" name="tab" value={tab} />
        <select name="site" defaultValue={siteId ?? ""}>
          {campaign.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.domain})
            </option>
          ))}
        </select>
        <button className="secondary">Show</button>
        <a className="button secondary" href={`/campaigns/${id}`}>
          Back
        </a>
      </form>

      {q ? (
        <p className="muted">
          Filtered to “{q}”. <a href={tabHref(tab)}>Show all</a>
        </p>
      ) : null}

      <div className="tabs">
        <a className={tab === "open" ? "active" : ""} href={tabHref("open")}>
          Open
        </a>
        <a className={tab === "resolved" ? "active" : ""} href={tabHref("resolved")}>
          Resolved
        </a>
      </div>

      {loadError ? (
        <p className="error">{loadError} — apply migration 0011 (query_conflicts).</p>
      ) : null}

      {regressed.length > 0 && tab === "open" ? (
        <div className="card" style={{ background: "#fef2f2", borderColor: "#fecaca" }}>
          <strong style={{ color: "#b91c1c" }}>
            {regressed.length} previously-resolved{" "}
            {regressed.length === 1 ? "conflict has" : "conflicts have"} come back:
          </strong>{" "}
          <span className="muted">
            {regressed.map((c) => `“${c.query}”`).join(", ")} — a fix that stopped holding is worth
            looking at before anything newly detected.
          </span>
        </div>
      ) : null}

      <div className="card">
        {conflicts.length === 0 ? (
          <p className="muted">
            {tab === "resolved"
              ? "Nothing resolved yet. Conflicts move here once one URL holds more than " +
                `${Math.round(CONFLICT_LIFECYCLE.resolvedOwnerShare * 100)}% of the query and the demand holds up.`
              : "No competing URLs tracked for this site yet. The nightly analysis records them; " +
                "run it from the Opportunities page to populate this now."}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Query / owner</th>
                <th>Status</th>
                <th>Trend</th>
                <th className="num">Owner share</th>
                <th className="num">Impressions</th>
                <th>First seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => {
                const snapshots = snapshotsByConflict.get(c.id) ?? [];
                const latest = snapshots[snapshots.length - 1];
                const baselineShare =
                  c.baseline_owner_share == null ? null : Number(c.baseline_owner_share);
                const currentShare = c.owner_share == null ? null : Number(c.owner_share);
                const delta =
                  baselineShare == null || currentShare == null
                    ? null
                    : Math.round((currentShare - baselineShare) * 100);
                const impressionDelta =
                  Number(c.baseline_impressions) > 0
                    ? Math.round(
                        (Number(c.total_impressions) / Number(c.baseline_impressions) - 1) * 100,
                      )
                    : null;
                return (
                  <tr key={c.id}>
                    <td>
                      <div>
                        <strong>{c.query}</strong>
                      </div>
                      <span className="owner-url">{prettyUrl(c.owner_page)}</span>
                      {latest && latest.contenders.length > 1 ? (
                        <details>
                          <summary className="muted" style={{ cursor: "pointer" }}>
                            {c.contender_count} competing URLs
                          </summary>
                          <table style={{ marginTop: "0.4rem" }}>
                            <tbody>
                              {latest.contenders.map((x) => (
                                <tr key={x.page}>
                                  <td className="owner-url">{prettyUrl(x.page)}</td>
                                  <td className="num">
                                    {Number(x.impressions).toLocaleString()}
                                  </td>
                                  <td className="num">{fmtShare(Number(x.share))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`badge conflict-${c.status}`}
                        title={STATUS_HELP[c.status]}
                      >
                        {STATUS_LABEL[c.status]}
                      </span>
                      {c.acknowledged_at ? (
                        <div className="muted" style={{ fontSize: "0.7rem" }}>
                          seen {fmtDate(c.acknowledged_at)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Trend snapshots={snapshots} />
                      <div className="muted" style={{ fontSize: "0.7rem" }}>
                        {snapshots.length} run{snapshots.length === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="num">
                      {fmtShare(currentShare)}
                      {delta != null && delta !== 0 ? (
                        <div
                          className="muted"
                          style={{ fontSize: "0.7rem", color: delta > 0 ? "#15803d" : "#b91c1c" }}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta}pp
                        </div>
                      ) : null}
                    </td>
                    <td className="num">
                      {Number(c.total_impressions).toLocaleString()}
                      {impressionDelta != null && impressionDelta !== 0 ? (
                        <div
                          className="muted"
                          style={{
                            fontSize: "0.7rem",
                            color: impressionDelta > 0 ? "#15803d" : "#b91c1c",
                          }}
                        >
                          {impressionDelta > 0 ? "+" : ""}
                          {impressionDelta}% vs baseline
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {fmtDate(c.first_seen_at)}
                      <div className="muted" style={{ fontSize: "0.7rem" }}>
                        {c.status === "resolved" && c.resolved_at
                          ? `resolved in ${daysBetween(c.first_seen_at, new Date(c.resolved_at))}d`
                          : `${daysBetween(c.first_seen_at, now)}d open`}
                      </div>
                    </td>
                    <td>
                      {!c.acknowledged_at && c.status !== "resolved" ? (
                        <form action={acknowledgeConflict} style={{ margin: 0 }}>
                          <input type="hidden" name="campaignId" value={id} />
                          <input type="hidden" name="conflictId" value={c.id} />
                          <input type="hidden" name="returnTo" value={tabHref(tab)} />
                          <button className="secondary">Mark seen</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          <strong>How this is measured.</strong> A query is tracked once at least two URLs each
          take {Math.round(CONFLICT_LIFECYCLE.minShare * 100)}% of its impressions. Every nightly
          run adds a point to the trend. It is called <em>resolved</em> only when one URL exceeds{" "}
          {Math.round(CONFLICT_LIFECYCLE.resolvedOwnerShare * 100)}% of the query{" "}
          <em>and</em> the query still holds at least{" "}
          {Math.round(CONFLICT_LIFECYCLE.impressionRetention * 100)}% of the impressions it had when
          first detected. If the competing URLs stop showing but the impressions fell away with
          them, that is <em>collapsed</em>, not resolved — the contention ended because the demand
          did. Everything is measured against first detection, never against last week, so a slow
          decline cannot be mistaken for a fix.
        </p>
      </div>
    </div>
  );
}
