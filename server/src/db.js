import { createClient } from "@libsql/client";

const url =
  process.env.TURSO_DATABASE_URL || "file:./data/nimiq-racer.sqlite";
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export const db = createClient({ url, authToken });

export async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      score INTEGER NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      obstacles_avoided INTEGER NOT NULL DEFAULT 0,
      bonuses_collected INTEGER NOT NULL DEFAULT 0,
      distance REAL NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      car_color TEXT,
      device_id TEXT,
      device_verified INTEGER NOT NULL DEFAULT 0,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
    CREATE INDEX IF NOT EXISTS idx_sessions_score ON sessions(score DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES sessions(id),
      username TEXT,
      type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      car_hex TEXT NOT NULL,
      car_name TEXT NOT NULL,
      tx_hash TEXT,
      price_luna INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device_id, car_hex)
    );

    CREATE INDEX IF NOT EXISTS idx_purchases_device_id ON purchases(device_id);

    CREATE TABLE IF NOT EXISTS power_up_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      power_up TEXT NOT NULL,
      tx_hash TEXT,
      price_luna INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_powerups_device_id ON power_up_purchases(device_id);

    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      creator_username TEXT NOT NULL,
      creator_score INTEGER NOT NULL,
      creator_device_id TEXT,
      accepted_by TEXT,
      accepted_score INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS streaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      signature TEXT NOT NULL,
      day_date TEXT NOT NULL,
      streak_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device_id, day_date)
    );

    CREATE INDEX IF NOT EXISTS idx_streaks_device_id ON streaks(device_id);

    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      badge TEXT NOT NULL,
      session_id INTEGER REFERENCES sessions(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device_id, badge)
    );

    CREATE INDEX IF NOT EXISTS idx_achievements_device_id ON achievements(device_id);
  `);

  // Migration guard: add device_id / device_verified columns if missing (pre-existing DB).
  try {
    const cols = await db.execute(`PRAGMA table_info(sessions)`);
    const hasDeviceId = cols.rows.some((c) => c.name === "device_id");
    if (!hasDeviceId) {
      await db.execute(`ALTER TABLE sessions ADD COLUMN device_id TEXT`);
      await db.execute(`ALTER TABLE sessions ADD COLUMN device_verified INTEGER NOT NULL DEFAULT 0`);
    }
  } catch {
    // PRAGMA may not be supported on all Turso plans; schema already includes the columns.
  }

  // Prune old events to keep the database lean.
  const maxAgeDays = parseInt(process.env.EVENTS_MAX_AGE_DAYS, 10) || 90;
  await db.execute({
    sql: `DELETE FROM events WHERE created_at < datetime('now', '-' || ? || ' days')`,
    args: [maxAgeDays],
  });
}
