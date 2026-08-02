import { notFound, redirect } from "next/navigation";
import { buildObservations, type QueryPageTotals } from "@entity-builder/scoring";
import { QueryOwnerCell, type ContenderRow, type QueryOwnerRow } from "@/components/query-owner";
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
  // Present only on the "by query" dimension (gsc_query_owner_totals).
  owner_page?: string | null;
  owner_impressions?: number;
  owner_share?: number;
  url_count?: number;
  contender_count?: number;
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
  // query -> the URLs competing for it, for the expandable split.
  const splits = new Map<string, ContenderRow[]>();

  if (siteId) {
    // "By query" uses gsc_query_owner_totals (migration 0011): same
    // aggregate columns as gsc_query_totals, plus the owning URL and the
    // contender count so a query is never shown without its URL.
    const fn =
      dim === "page"
        ? "gsc_page_totals"
        : dim === "date"
          ? "gsc_daily_totals"
          : "gsc_query_owner_totals";
    const args: Record<string, unknown> = { p_site_id: siteId, p_from: from, p_to: to };
    if (dim !== "date") args.p_limit = 1000;
    const { data, error } = await supabase.rpc(fn, args);
    if (error) rpcError = error.message;
    rows = (data ?? []) as TotalsRow[];

    if (dim === "query" && !error) {
      // Second pass for the per-query URL split, asked for BY QUERY rather
      // than from the row-capped gsc_query_page_totals. The badge count
      // comes from an uncapped aggregate, so a capped split fetch could
      // badge a row and then have nothing to expand — the exact thing the
      // badge promises. Bounded by the number of contested rows on screen.
      const contested = rows
        .filter((r) => r.query !== undefined && Number(r.contender_count ?? 0) >= 2)
        .map((r) => r.query as string);

      if (contested.length > 0) {
        const pairs = await supabase.rpc("gsc_query_page_totals_for_queries", {
          p_site_id: siteId,
          p_from: from,
          p_to: to,
          p_queries: contested,
        });
        if (!pairs.error) {
          // buildObservations is the same function the cannibalisation
          // detector uses, so the expanded view and the opportunity feed
          // can never disagree about who competes for a query.
          for (const o of buildObservations((pairs.data ?? []) as QueryPageTotals[])) {
            if (o.contenders.length > 1) splits.set(o.query, o.contenders);
          }
        }
      }
    }
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
                    {dim === "page" ? "Page" : dim === "date" ? "Date" : "Query / owning URL"}
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
                  {dim === "query" && r.query !== undefined ? (
                    <QueryOwnerCell
                      row={
                        {
                          query: r.query,
                          clicks: Number(r.clicks),
                          impressions: Number(r.impressions),
                          ctr: Number(r.ctr),
                          position: r.position,
                          owner_page: r.owner_page ?? null,
                          owner_impressions: Number(r.owner_impressions ?? 0),
                          owner_share: Number(r.owner_share ?? 0),
                          url_count: Number(r.url_count ?? 0),
                          contender_count: Number(r.contender_count ?? 0),
                        } satisfies QueryOwnerRow
                      }
                      contenders={splits.get(r.query)}
                      conflictHref={`/campaigns/${id}/conflicts?site=${siteId}&q=${encodeURIComponent(r.query)}`}
                    />
                  ) : (
                    <td>{r.query ?? r.page ?? r.date}</td>
                  )}
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
