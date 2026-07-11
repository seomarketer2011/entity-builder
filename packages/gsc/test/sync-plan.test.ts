import { describe, expect, it } from "vitest";
import {
  addDays,
  freshestSyncableDate,
  planBackfillWindows,
  planIncrementalWindow,
} from "../src/sync-plan.js";

describe("freshestSyncableDate", () => {
  it("is today minus the 3-day freshness lag", () => {
    expect(freshestSyncableDate("2026-07-11")).toBe("2026-07-08");
  });
});

describe("planBackfillWindows", () => {
  it("covers exactly 16 months ending at the freshest syncable date", () => {
    const windows = planBackfillWindows("2026-07-11");
    expect(windows[0]!.dateFrom).toBe("2025-03-08");
    expect(windows.at(-1)!.dateTo).toBe("2026-07-08");
  });

  it("produces contiguous, non-overlapping monthly windows", () => {
    const windows = planBackfillWindows("2026-07-11");
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.dateFrom).toBe(addDays(windows[i - 1]!.dateTo, 1));
    }
    for (const w of windows) {
      expect(w.dateFrom <= w.dateTo).toBe(true);
    }
  });

  it("handles month-end starts without skipping days", () => {
    const windows = planBackfillWindows("2026-03-03"); // freshest = 2026-02-28
    expect(windows[0]!.dateFrom).toBe("2024-10-28");
    expect(windows.at(-1)!.dateTo).toBe("2026-02-28");
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.dateFrom).toBe(addDays(windows[i - 1]!.dateTo, 1));
    }
  });
});

describe("planIncrementalWindow", () => {
  it("re-pulls the trailing 3 days through the freshest date", () => {
    const window = planIncrementalWindow("2026-07-11", "2026-07-05");
    expect(window).toEqual({ dateFrom: "2026-07-03", dateTo: "2026-07-08" });
  });

  it("returns null when already up to date", () => {
    // last synced 2026-07-08; freshest is 2026-07-08 → re-pull window still
    // applies (restatements), so choose a synced date beyond freshest instead
    const window = planIncrementalWindow("2026-07-11", "2026-07-11");
    expect(window).toBeNull();
  });

  it("still re-pulls when synced through the freshest date (restatements)", () => {
    const window = planIncrementalWindow("2026-07-11", "2026-07-08");
    expect(window).toEqual({ dateFrom: "2026-07-06", dateTo: "2026-07-08" });
  });
});
