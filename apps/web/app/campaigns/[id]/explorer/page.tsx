import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface TotalsRow {
  query?: string;
  page?: string;
  date?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtPos(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}

export default async function ExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ site?: string; from?: string; to?: string; dim?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, sites(id, name, domain)")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  const siteId = query.site ?? campaign.sites[0]?.id;
  const dim = query.dim === "page" ? "page" : query.dim === "date" ? "date" : "query";
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10);
  const from = query.from ?? defaultFrom;
  const to = query.to ?? today;

  let rows: TotalsRow[] = [];
  let rpcError: string | null = null;
  if (siteId) {
    const fn =
      dim === "page" ? "gsc_page_totals" : dim === "date" ? "gsc_daily_totals" : "gsc_query_totals";
    const args: Record<string, unknown> = { p_site_id: siteId, p_from: from, p_to: to };
    if (dim !== "date") args.p_limit = 200;
    const { data, error } = await supabase.rpc(fn, args);
    if (error) rpcError = error.message;
    rows = (data ?? []) as TotalsRow[];
  }

  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks), 0);
  const totalImpressions = rows.reduce((s, r) => s + Number(r.impressions), 0);

  return (
    <div>
      <h1>GSC Explorer — {campaign.name}</h1>

      <form className="inline" method="get">
        <select name="site" defaultValue={siteId ?? ""}>
          {campaign.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.domain})
            </option>
          ))}
        </select>
        <select name="dim" defaultValue={dim}>
          <option value="query">By query</option>
          <option value="page">By page</option>
          <option value="date">By date</option>
        </select>
        <input name="from" type="date" defaultValue={from} />
        <input name="to" type="date" defaultValue={to} />
        <button>Apply</button>
        <a className="button secondary" href={`/campaigns/${id}`}>
          Back
        </a>
      </form>

      {rpcError ? <p className="error">{rpcError}</p> : null}

      <div className="card">
        <p className="muted">
          {rows.length} rows · {totalClicks.toLocaleString()} clicks ·{" "}
          {totalImpressions.toLocaleString()} impressions · {from} → {to}
        </p>
        {rows.length === 0 ? (
          <p className="muted">
            No data. Queue a backfill on the campaign page, then let the worker run.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{dim === "page" ? "Page" : dim === "date" ? "Date" : "Query"}</th>
                <th className="num">Clicks</th>
                <th className="num">Impressions</th>
                <th className="num">CTR</th>
                <th className="num">Position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.query ?? r.page ?? r.date}</td>
                  <td className="num">{Number(r.clicks).toLocaleString()}</td>
                  <td className="num">{Number(r.impressions).toLocaleString()}</td>
                  <td className="num">{fmtPct(Number(r.ctr))}</td>
                  <td className="num">{fmtPos(r.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
