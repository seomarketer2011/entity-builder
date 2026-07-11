/**
 * gsc_sync_jobs state transitions. The worker claims queued jobs with
 * SKIP LOCKED so concurrent workers never double-run a job.
 */

import type { Queryable } from "./pool.js";

export interface SyncJobRecord {
  id: string;
  organisation_id: string;
  property_id: string;
  kind: "backfill" | "incremental";
  date_from: string;
  date_to: string;
}

export async function claimNextJob(db: Queryable): Promise<SyncJobRecord | null> {
  const result = await db.query(
    `update gsc_sync_jobs
     set status = 'running', started_at = now()
     where id = (
       select id from gsc_sync_jobs
       where status = 'queued'
       order by created_at
       limit 1
       for update skip locked
     )
     returning id, organisation_id, property_id, kind,
               date_from::text, date_to::text`,
  );
  return (result.rows[0] as SyncJobRecord | undefined) ?? null;
}

export async function completeJob(
  db: Queryable,
  jobId: string,
  rowsImported: number,
): Promise<void> {
  await db.query(
    `update gsc_sync_jobs
     set status = 'succeeded', finished_at = now(), rows_imported = $2
     where id = $1`,
    [jobId, rowsImported],
  );
}

export async function failJob(db: Queryable, jobId: string, error: string): Promise<void> {
  await db.query(
    `update gsc_sync_jobs
     set status = 'failed', finished_at = now(), error = $2
     where id = $1`,
    [jobId, error.slice(0, 2000)],
  );
}

/** Most recent fact date for a property — drives incremental planning. */
export async function lastSyncedDate(
  db: Queryable,
  propertyId: string,
): Promise<string | null> {
  const result = await db.query(
    `select max(date)::text as last_date from gsc_daily_query_page where property_id = $1`,
    [propertyId],
  );
  return (result.rows[0]?.last_date as string | null) ?? null;
}
