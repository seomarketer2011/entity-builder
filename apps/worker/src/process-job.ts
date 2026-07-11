/**
 * Runs one claimed gsc_sync_job end to end. All IO behind small injected
 * lookups so the flow is testable without Google or Postgres.
 */

import {
  refreshAccessToken,
  runSync,
  type FetchLike,
  type GscFactRow,
  type SyncResult,
} from "@entity-builder/gsc";

export interface JobContext {
  jobId: string;
  kind: "backfill" | "incremental";
  propertyId: string;
  today: string;
}

export interface JobDeps {
  fetchImpl: FetchLike;
  oauth: { clientId: string; clientSecret: string };
  /** Decrypted at call time only — never stored or logged (docs/SECURITY.md). */
  getRefreshToken: (propertyId: string) => Promise<string>;
  getPropertyUri: (propertyId: string) => Promise<{ propertyUri: string; siteId: string }>;
  getLastSyncedDate: (propertyId: string) => Promise<string | null>;
  writeRows: (propertyId: string, siteId: string, rows: GscFactRow[]) => Promise<void>;
}

export async function processJob(job: JobContext, deps: JobDeps): Promise<SyncResult> {
  const { propertyUri, siteId } = await deps.getPropertyUri(job.propertyId);

  let lastSyncedDate: string | undefined;
  if (job.kind === "incremental") {
    const last = await deps.getLastSyncedDate(job.propertyId);
    if (!last) {
      throw new Error(
        `incremental sync for ${propertyUri} has no prior data — run a backfill first`,
      );
    }
    lastSyncedDate = last;
  }

  return runSync(
    { kind: job.kind, propertyUri, today: job.today, lastSyncedDate },
    {
      fetchImpl: deps.fetchImpl,
      getAccessToken: async () => {
        const refreshToken = await deps.getRefreshToken(job.propertyId);
        const grant = await refreshAccessToken(deps.fetchImpl, deps.oauth, refreshToken);
        return grant.accessToken;
      },
      upsertRows: (rows) => deps.writeRows(job.propertyId, siteId, rows),
    },
  );
}
