/**
 * Worker entrypoint: claims queued gsc_sync_jobs (SKIP LOCKED), runs each
 * via processJob, records success/failure, sleeps when the queue is empty.
 */

import {
  claimNextJob,
  completeJob,
  failJob,
  getPool,
  lastSyncedDate,
  upsertGscRows,
} from "@entity-builder/database";
import { decryptToken } from "@entity-builder/gsc";
import { processJob } from "./process-job.ts";

const POLL_INTERVAL_MS = 15_000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function tick(): Promise<boolean> {
  const pool = getPool();
  const job = await claimNextJob(pool);
  if (!job) return false;

  console.log(`[worker] job ${job.id} (${job.kind}) property=${job.property_id}`);
  try {
    const result = await processJob(
      {
        jobId: job.id,
        kind: job.kind,
        propertyId: job.property_id,
        today: new Date().toISOString().slice(0, 10),
      },
      {
        fetchImpl: fetch as never,
        oauth: {
          clientId: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
          clientSecret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
        },
        getRefreshToken: async (propertyId) => {
          const { rows } = await pool.query(
            `select c.encrypted_refresh_token, c.token_nonce
             from gsc_properties p
             join google_connections c on c.id = p.connection_id
             where p.id = $1 and c.revoked_at is null`,
            [propertyId],
          );
          const row = rows[0];
          if (!row) throw new Error(`no active connection for property ${propertyId}`);
          return decryptToken(
            { ciphertext: row.encrypted_refresh_token, nonce: row.token_nonce },
            requiredEnv("TOKEN_ENCRYPTION_KEY"),
          );
        },
        getPropertyUri: async (propertyId) => {
          const { rows } = await pool.query(
            `select property_uri, site_id from gsc_properties where id = $1`,
            [propertyId],
          );
          const row = rows[0];
          if (!row) throw new Error(`unknown property ${propertyId}`);
          if (!row.site_id) throw new Error(`property ${propertyId} is not linked to a site`);
          return { propertyUri: row.property_uri, siteId: row.site_id };
        },
        getLastSyncedDate: (propertyId) => lastSyncedDate(pool, propertyId),
        writeRows: async (propertyId, siteId, rows) => {
          await upsertGscRows(pool, propertyId, siteId, rows);
        },
      },
    );
    await completeJob(pool, job.id, result.totalRows);
    console.log(`[worker] job ${job.id} succeeded: ${result.totalRows} rows`);
    await pool.query("select refresh_gsc_views()").catch((e) => {
      console.warn(`[worker] view refresh failed: ${e.message}`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[worker] job ${job.id} failed: ${message}`);
    await failJob(pool, job.id, message);
  }
  return true;
}

async function main(): Promise<void> {
  console.log("[worker] started");
  for (;;) {
    let ranJob = false;
    try {
      ranJob = await tick();
    } catch (error) {
      console.error(`[worker] tick error: ${error}`);
    }
    if (!ranJob) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
