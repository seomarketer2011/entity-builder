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

type SortKey = "label" | "clicks" | "impressions" | "ctr" | "position";

function sortRows(rows: TotalsRow[], sort: SortKey, dir: "asc" | "desc"): TotalsRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === "label") {
      const la = a.query ?? a.page ?? a.date ?? "";
      const lb = b.query ?? b.page ?? b.date ?? "";
      return la.localeCompare(lb) * factor;
    }
    if (sort === "position") {
      // nulls always last regardless of direction
      const pa = a.position;
      const pb = b.position;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return (pa - pb) * factor;
    }
    return (Number(a[sort]) - Number(b[sort])) * factor;
  });
}

export default async function ExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    site?: string;
    from?: string;
    to?: string;
    dim?: string;
    sort?: string;
    dir?: string;
  }>;
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
    if (dim !== "date") args.p_limit = 1000;
    const { data, error } = await supabase.rpc(fn, args);
    if (error) rpcError = error.message;
    rows = (data ?? []) as TotalsRow[];
  }

  const validSorts: SortKey[] = ["label", "clicks", "impressions", "ctr", "position"];
  const sort: SortKey = validSorts.includes(query.sort as SortKey)
    ? (query.sort as SortKey)
    : "clicks";
  const dir: "asc" | "desc" = query.dir === "asc" ? "asc" : "desc";
  rows = sortRows(rows, sort, dir);

  const baseParams = new URLSearchParams({
    ...(siteId ? { site: siteId } : {}),
    dim,
    from,
    to,
  });
  const sortLink = (key: SortKey) => {
    const p = new URLSearchParams(baseParams);
    p.set("sort", key);
    p.set("dir", sort === key && dir === "desc" ? "asc" : "desc");
    return `/campaigns/${id}/explorer?${p.toString()}`;
  };
  const arrow = (key: SortKey) => (sort === key ? (dir === "desc" ? " ▼" : " ▲") : "");

  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks), 0);
  const totalImpressions = rows.reduce((s, r) => s + Number(r.impressions), 0);

  return (
    <div>
      <h1>GSC Explorer — {campaign.name}</h1>

      <form className="inline" method="get">
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
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
                <th>
                  <a href={sortLink("label")} style={{ color: "inherit" }}>
                    {dim === "page" ? "Page" : dim === "date" ? "Date" : "Query"}
                    {arrow("label")}
                  </a>
                </th>
                <th className="num">
                  <a href={sortLink("clicks")} style={{ color: "inherit" }}>
                    Clicks{arrow("clicks")}
                  </a>
                </th>
                <th className="num">
                  <a href={sortLink("impressions")} style={{ color: "inherit" }}>
                    Impressions{arrow("impressions")}
                  </a>
                </th>
                <th className="num">
                  <a href={sortLink("ctr")} style={{ color: "inherit" }}>
                    CTR{arrow("ctr")}
                  </a>
                </th>
                <th className="num">
                  <a href={sortLink("position")} style={{ color: "inherit" }}>
                    Position{arrow("position")}
                  </a>
                </th>
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
