import {
  addDays,
  addMonths,
  decryptToken,
  fetchAllRows,
  mapApiRow,
  refreshAccessToken,
  SYNC_DIMENSIONS,
  type FetchLike,
} from "@entity-builder/gsc";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Sync step endpoint, called by the cron pinger worker every few minutes.
 * Claims the oldest queued gsc_sync_job and processes ONE month-sized
 * window, then re-queues the job with date_from advanced (resumable, and
 * keeps each invocation within Workers CPU limits). Marks the job
 * succeeded when the window reaches date_to.
 *
 * Auth: shared-secret bearer token (SYNC_TOKEN). Uses the service-role
 * key — this route is the only trusted-context data path in the app.
 */

// Larger batches keep big months inside the per-invocation subrequest cap
// (each upsert call is one subrequest; CR9's 15k-row months hit the limit
// at 500).
const BATCH = 2000;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}

function hexToBuffer(value: string): Buffer {
  return Buffer.from(String(value).replace(/^\\x/, ""), "hex");
}

export async function POST(request: Request) {
  const expected = process.env.SYNC_TOKEN;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let db;
  try {
    db = admin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "config" },
      { status: 503 },
    );
  }

  // Reclaim jobs orphaned by an aborted invocation: 'running' with no
  // progress heartbeat for 5+ minutes goes back to 'queued'. Progress is
  // persisted after every window, so at most one window repeats (idempotent
  // upserts make the repeat harmless).
  // Successful windows heartbeat every ~10-20s, so 2 minutes of silence
  // reliably means the invocation was killed.
  const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
  await db
    .from("gsc_sync_jobs")
    .update({ status: "queued" })
    .eq("status", "running")
    .lt("started_at", staleBefore);

  // Oldest queued job, claimed with a compare-and-set so concurrent
  // invocations never double-process.
  const { data: candidates } = await db
    .from("gsc_sync_jobs")
    .select("id, property_id, kind, date_from, date_to, rows_imported")
    .eq("status", "queued")
    .order("created_at")
    .limit(1);
  const job = candidates?.[0];
  if (!job) return NextResponse.json({ idle: true });

  const { data: claimed } = await db
    .from("gsc_sync_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return NextResponse.json({ raced: true });

  const fail = async (message: string) => {
    await db
      .from("gsc_sync_jobs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 2000) })
      .eq("id", job.id);
    return NextResponse.json({ jobId: job.id, failed: message }, { status: 500 });
  };

  try {
    const { data: property } = await db
      .from("gsc_properties")
      .select(
        "property_uri, site_id, google_connections(encrypted_refresh_token, token_nonce, revoked_at)",
      )
      .eq("id", job.property_id)
      .single();
    if (!property) return await fail("property not found");
    if (!property.site_id) return await fail("property is not linked to a site");
    const connection = property.google_connections as unknown as {
      encrypted_refresh_token: string;
      token_nonce: string;
      revoked_at: string | null;
    } | null;
    if (!connection || connection.revoked_at) {
      return await fail("no active Google connection — reconnect Google for this organisation");
    }

    const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!encryptionKey || !clientId || !clientSecret) return await fail("OAuth env incomplete");

    let refreshToken: string;
    try {
      refreshToken = decryptToken(
        {
          ciphertext: hexToBuffer(connection.encrypted_refresh_token),
          nonce: hexToBuffer(connection.token_nonce),
        },
        encryptionKey,
      );
    } catch {
      return await fail(
        "stored token cannot be decrypted (encryption key changed) — reconnect Google",
      );
    }

    const fetchImpl = fetch as unknown as FetchLike;
    const grant = await refreshAccessToken(fetchImpl, { clientId, clientSecret }, refreshToken);

    // Process month-sized windows until the job finishes or the wall-clock
    // budget runs out; remaining windows continue on the next cron tick.
    // Workers Paid + raised cpu_ms make longer invocations safe; progress
    // still persists per window so interruptions stay cheap.
    const WALL_BUDGET_MS = 45_000;
    const startedAt = Date.now();
    let cursor = job.date_from;
    let rowsThisRun = 0;
    let windowsThisRun = 0;
    let windowEnd = cursor;

    for (;;) {
      const monthEnd = addDays(addMonths(cursor, 1), -1);
      windowEnd = monthEnd < job.date_to ? monthEnd : job.date_to;

      await fetchAllRows(
        fetchImpl,
        grant.accessToken,
        property.property_uri,
        { startDate: cursor, endDate: windowEnd, dimensions: [...SYNC_DIMENSIONS] },
        async (apiRows) => {
          const mapped = apiRows.map((r) => mapApiRow(r));
          for (let i = 0; i < mapped.length; i += BATCH) {
            const chunk = mapped.slice(i, i + BATCH).map((row) => ({
              property_id: job.property_id,
              site_id: property.site_id,
              date: row.date,
              page: row.page,
              query: row.query,
              country: row.country,
              device: row.device,
              search_type: row.searchType,
              clicks: row.clicks,
              impressions: row.impressions,
              position: row.position,
            }));
            const { error } = await db.from("gsc_daily_query_page").upsert(chunk, {
              onConflict: "property_id,date,page,query,country,device,search_type",
            });
            if (error) throw new Error(`upsert failed: ${error.message}`);
            rowsThisRun += chunk.length;
          }
        },
      );
      windowsThisRun++;

      if (windowEnd >= job.date_to) break;
      cursor = addDays(windowEnd, 1);
      // Persist progress + heartbeat after every window, so an aborted
      // invocation loses at most one (idempotently repeatable) window.
      await db
        .from("gsc_sync_jobs")
        .update({
          date_from: cursor,
          rows_imported: (job.rows_imported ?? 0) + rowsThisRun,
          started_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (Date.now() - startedAt > WALL_BUDGET_MS) {
        // hand the rest to the next tick
        await db.from("gsc_sync_jobs").update({ status: "queued" }).eq("id", job.id);
        return NextResponse.json({
          jobId: job.id,
          window: { from: job.date_from, to: windowEnd },
          windowsThisRun,
          rowsInWindow: rowsThisRun,
          totalRows: (job.rows_imported ?? 0) + rowsThisRun,
          done: false,
        });
      }
    }

    const rowsInWindow = rowsThisRun;
    const totalRows = (job.rows_imported ?? 0) + rowsThisRun;
    const done = windowEnd >= job.date_to;
    if (done) {
      await db
        .from("gsc_sync_jobs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          rows_imported: totalRows,
        })
        .eq("id", job.id);
      await db.rpc("refresh_gsc_views");
    } else {
      await db
        .from("gsc_sync_jobs")
        .update({
          status: "queued", // next cron tick continues from the next window
          date_from: addDays(windowEnd, 1),
          rows_imported: totalRows,
        })
        .eq("id", job.id);
    }

    return NextResponse.json({
      jobId: job.id,
      window: { from: job.date_from, to: windowEnd },
      windowsThisRun,
      rowsInWindow,
      totalRows,
      done,
    });
  } catch (error) {
    return await fail(error instanceof Error ? error.message : String(error));
  }
}
