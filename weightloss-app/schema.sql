-- Weight-loss tracker schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,               -- YYYY-MM-DD (the weigh-in day)
  weight_kg  REAL NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

-- Single-row settings table (goal + profile)
CREATE TABLE IF NOT EXISTS settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  start_date      TEXT,
  start_weight_kg REAL,
  goal_weight_kg  REAL,
  goal_date       TEXT,
  height_cm       REAL
);

INSERT OR IGNORE INTO settings (id) VALUES (1);
