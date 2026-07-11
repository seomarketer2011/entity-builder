/**
 * Sync planning — docs/GSC_INGESTION.md.
 * GSC data lags ~2 days; the freshest date we trust is today - 3.
 * Backfill covers up to 16 months in monthly windows (resumable).
 * Incremental re-pulls the trailing 3 days to catch restatements.
 * All functions take `today` explicitly — deterministic and testable.
 */

export interface DateWindow {
  dateFrom: string; // inclusive
  dateTo: string; // inclusive
}

export const GSC_FRESHNESS_LAG_DAYS = 3;
export const BACKFILL_MONTHS = 16;
export const INCREMENTAL_REPULL_DAYS = 3;

function toDate(iso: string): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${iso}`);
  return d;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return toIso(d);
}

/** Latest date GSC data is trusted for, given today. */
export function freshestSyncableDate(today: string): string {
  return addDays(today, -GSC_FRESHNESS_LAG_DAYS);
}

/**
 * Full backfill window split into calendar-month-sized chunks, oldest
 * first, so a failed backfill resumes at the first incomplete chunk.
 */
export function planBackfillWindows(today: string): DateWindow[] {
  const end = freshestSyncableDate(today);
  const start = addMonths(end, -BACKFILL_MONTHS);
  const windows: DateWindow[] = [];
  let from = start;
  while (from <= end) {
    const nextFrom = addMonths(from, 1);
    const to = addDays(nextFrom, -1) < end ? addDays(nextFrom, -1) : end;
    windows.push({ dateFrom: from, dateTo: to });
    from = nextFrom;
  }
  return windows;
}

/**
 * Incremental window: from (last synced date - re-pull overlap) to the
 * freshest syncable date. Returns null when there is nothing new.
 */
export function planIncrementalWindow(
  today: string,
  lastSyncedDate: string,
): DateWindow | null {
  const to = freshestSyncableDate(today);
  const from = addDays(lastSyncedDate, -(INCREMENTAL_REPULL_DAYS - 1));
  if (from > to) return null;
  return { dateFrom: from, dateTo: to };
}
