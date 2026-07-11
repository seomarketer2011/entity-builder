/**
 * Idempotent multi-row upsert into gsc_daily_query_page — re-running any
 * window is always safe (docs/GSC_INGESTION.md). SQL building is separated
 * from execution so it can be unit-tested without a database.
 */

import type { GscFactRow } from "@entity-builder/gsc";
import type { Queryable } from "./pool.js";

export const GSC_UPSERT_BATCH_SIZE = 1000;

export interface UpsertStatement {
  text: string;
  values: unknown[];
}

const COLUMNS = [
  "property_id",
  "site_id",
  "date",
  "page",
  "query",
  "country",
  "device",
  "search_type",
  "clicks",
  "impressions",
  "position",
] as const;

export function buildGscUpsert(
  propertyId: string,
  siteId: string,
  rows: GscFactRow[],
): UpsertStatement {
  if (rows.length === 0) throw new Error("no rows to upsert");
  if (rows.length > GSC_UPSERT_BATCH_SIZE) {
    throw new Error(`batch too large: ${rows.length} > ${GSC_UPSERT_BATCH_SIZE}`);
  }

  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const tuple = [
      propertyId,
      siteId,
      row.date,
      row.page,
      row.query,
      row.country,
      row.device,
      row.searchType,
      row.clicks,
      row.impressions,
      row.position,
    ];
    const placeholders = tuple.map((v) => {
      values.push(v);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const text = `insert into gsc_daily_query_page (${COLUMNS.join(", ")})
values ${tuples.join(",\n")}
on conflict (property_id, date, page, query, country, device, search_type)
do update set clicks = excluded.clicks,
              impressions = excluded.impressions,
              position = excluded.position`;

  return { text, values };
}

export async function upsertGscRows(
  db: Queryable,
  propertyId: string,
  siteId: string,
  rows: GscFactRow[],
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += GSC_UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + GSC_UPSERT_BATCH_SIZE);
    const statement = buildGscUpsert(propertyId, siteId, batch);
    await db.query(statement.text, statement.values);
    written += batch.length;
  }
  return written;
}
