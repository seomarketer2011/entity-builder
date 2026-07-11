import { describe, expect, it } from "vitest";
import type { GscFactRow } from "@entity-builder/gsc";
import {
  GSC_UPSERT_BATCH_SIZE,
  buildGscUpsert,
  upsertGscRows,
} from "../src/gsc-upsert.js";

function row(i: number): GscFactRow {
  return {
    date: "2026-07-01",
    page: `https://ex.com/p${i}`,
    query: `q${i}`,
    country: "gbr",
    device: "MOBILE",
    searchType: "web",
    clicks: i,
    impressions: i * 10,
    position: 2.5,
  };
}

describe("buildGscUpsert", () => {
  it("parameterises every value — no string interpolation of data", () => {
    const stmt = buildGscUpsert("prop-1", "site-1", [row(1), row(2)]);
    expect(stmt.values).toHaveLength(22); // 11 columns x 2 rows
    expect(stmt.text).not.toContain("ex.com"); // data only in values
    expect(stmt.text).toContain("$22");
  });

  it("targets the idempotency key and updates metrics on conflict", () => {
    const stmt = buildGscUpsert("prop-1", "site-1", [row(1)]);
    expect(stmt.text).toContain(
      "on conflict (property_id, date, page, query, country, device, search_type)",
    );
    expect(stmt.text).toContain("clicks = excluded.clicks");
  });

  it("rejects empty and oversized batches", () => {
    expect(() => buildGscUpsert("p", "s", [])).toThrow(/no rows/);
    const tooMany = Array.from({ length: GSC_UPSERT_BATCH_SIZE + 1 }, (_, i) => row(i));
    expect(() => buildGscUpsert("p", "s", tooMany)).toThrow(/batch too large/);
  });
});

describe("upsertGscRows", () => {
  it("splits large inputs into batches", async () => {
    const calls: number[] = [];
    const db = {
      query: async (_text: string, values?: unknown[]) => {
        calls.push((values?.length ?? 0) / 11);
        return { rows: [], rowCount: 0 };
      },
    };
    const rows = Array.from({ length: 2500 }, (_, i) => row(i));
    const written = await upsertGscRows(db, "prop-1", "site-1", rows);
    expect(written).toBe(2500);
    expect(calls).toEqual([1000, 1000, 500]);
  });
});
