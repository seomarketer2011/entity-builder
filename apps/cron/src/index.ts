/**
 * Cron pinger. All heavy lifting happens in the web app's
 * /api/internal/sync route; this worker just triggers one step per tick
 * and logs the outcome (visible via `wrangler tail entity-builder-cron`).
 */

interface Env {
  SYNC_ENDPOINT: string;
  SYNC_TOKEN: string;
  WEB: Fetcher;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const isDaily = event.cron === "30 5 * * *";
    const endpoint = isDaily
      ? env.SYNC_ENDPOINT.replace("/sync", "/schedule-daily")
      : env.SYNC_ENDPOINT;
    ctx.waitUntil(
      (async () => {
        const response = await env.WEB.fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${env.SYNC_TOKEN}` },
        });
        const body = await response.text();
        console.log(`${isDaily ? "daily schedule" : "sync step"}: ${response.status} ${body.slice(0, 500)}`);
      })(),
    );
  },
};
