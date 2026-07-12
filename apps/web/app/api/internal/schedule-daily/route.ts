import { addDays, freshestSyncableDate, INCREMENTAL_REPULL_DAYS } from "@entity-builder/gsc";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Daily scheduler, hit by the cron worker once a day: queues an
 * incremental sync job for every property that is linked to a site and
 * has an active Google connection, unless one is already queued/running.
 */
export async function POST(request: Request) {
  const expected = process.env.SYNC_TOKEN;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const db = createSupabaseClient(url, key, { auth: { persistSession: false } });

  const { data: properties } = await db
    .from("gsc_properties")
    .select("id, organisation_id, google_connections!inner(revoked_at)")
    .not("site_id", "is", null)
    .is("google_connections.revoked_at", null);

  const { data: openJobs } = await db
    .from("gsc_sync_jobs")
    .select("property_id")
    .in("status", ["queued", "running"]);
  const busy = new Set((openJobs ?? []).map((j) => j.property_id));

  const today = new Date().toISOString().slice(0, 10);
  const dateTo = freshestSyncableDate(today);
  const dateFrom = addDays(dateTo, -(INCREMENTAL_REPULL_DAYS - 1));

  const jobs = (properties ?? [])
    .filter((p) => !busy.has(p.id))
    .map((p) => ({
      organisation_id: p.organisation_id,
      property_id: p.id,
      kind: "incremental" as const,
      status: "queued" as const,
      date_from: dateFrom,
      date_to: dateTo,
    }));

  if (jobs.length > 0) {
    const { error } = await db.from("gsc_sync_jobs").insert(jobs);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ queued: jobs.length, skippedBusy: busy.size, window: { dateFrom, dateTo } });
}
