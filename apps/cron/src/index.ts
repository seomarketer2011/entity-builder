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
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const response = await env.WEB.fetch(env.SYNC_ENDPOINT, {
          method: "POST",
          headers: { authorization: `Bearer ${env.SYNC_TOKEN}` },
        });
        const body = await response.text();
        console.log(`sync step: ${response.status} ${body.slice(0, 500)}`);
      })(),
    );
  },
};
