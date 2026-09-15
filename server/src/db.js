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
