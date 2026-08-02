/**
 * Query ownership display, shared by the Explorer and the campaign
 * overview so both answer "which URL earns this query?" identically.
 *
 * The competitor badge only appears when a query is genuinely contested —
 * two or more URLs each holding at least CANNIBALISATION.minShare (25%) of
 * its impressions. GSC lists a long tail of URLs with a handful of
 * impressions for almost every query; badging those would put a warning on
 * nearly every row and make the signal worthless.
 */

import { CANNIBALISATION } from "@entity-builder/scoring";

/** Row shape returned by the gsc_query_owner_totals RPC (migration 0011). */
export interface QueryOwnerRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  owner_page: string | null;
  owner_impressions: number;
  owner_share: number;
  url_count: number;
  contender_count: number;
}

/** One competing URL, for the expanded split. */
export interface ContenderRow {
  page: string;
  clicks: number;
  impressions: number;
  share: number;
  position: number | null;
}

export const CONTENDER_SHARE = CANNIBALISATION.minShare;

/** A query is contested when two or more URLs clear the contender share. */
export function isContested(row: Pick<QueryOwnerRow, "contender_count">): boolean {
  return row.contender_count >= 2;
}

/** Strip the origin so the table shows paths, not 60-character URLs. */
export function prettyUrl(url: string | null): string {
  if (!url) return "—";
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return path === "/" ? parsed.host : path;
  } catch {
    return url;
  }
}

function fmtShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * The query cell: the query itself, a contested badge when it applies, and
 * the owning URL underneath. When `contenders` is supplied the badge cell
 * expands (native <details>, no client JS) to show the full split.
 */
export function QueryOwnerCell({
  row,
  contenders,
  conflictHref,
}: {
  row: QueryOwnerRow;
  contenders?: ContenderRow[];
  conflictHref?: string;
}) {
  const contested = isContested(row);
  const split = contenders ?? [];

  const badge = contested ? (
    <span className="badge contested" title={`${row.contender_count} URLs each hold at least ${fmtShare(CONTENDER_SHARE)} of this query`}>
      {row.contender_count} URLs compete
    </span>
  ) : null;

  return (
    <td>
      <div>
        <strong>{row.query}</strong>
        {conflictHref && contested ? <a href={conflictHref}>{badge}</a> : badge}
      </div>
      {split.length > 1 ? (
        <details>
          <summary className="owner-url" style={{ cursor: "pointer" }}>
            {prettyUrl(row.owner_page)} · {fmtShare(row.owner_share)}
            {row.url_count > 1 ? ` of ${row.impressions.toLocaleString()} impressions` : ""}
          </summary>
          <table style={{ marginTop: "0.4rem" }}>
            <thead>
              <tr>
                <th>Competing URL</th>
                <th className="num">Impressions</th>
                <th className="num">Share</th>
                <th className="num">Position</th>
              </tr>
            </thead>
            <tbody>
              {split.map((c) => (
                <tr key={c.page}>
                  <td className="owner-url">{prettyUrl(c.page)}</td>
                  <td className="num">{c.impressions.toLocaleString()}</td>
                  <td className="num">{fmtShare(c.share)}</td>
                  <td className="num">{c.position == null ? "—" : c.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : (
        <span className="owner-url">
          {prettyUrl(row.owner_page)}
          {row.url_count > 1 ? ` · ${fmtShare(row.owner_share)} of impressions` : ""}
        </span>
      )}
    </td>
  );
}
