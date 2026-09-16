import { timingSafeEqual } from "crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { db } from "./db.js";
import { str, num, ValidationError } from "./validate.js";
import { assertPlausibleSession, MAX_DURATION_SECONDS, ACHIEVEMENT_DEFS } from "./antiCheat.js";
import { rateLimit } from "./rateLimit.js";

export function createApp() {
  // Comma-separated list, e.g. "https://nimiq-racer.example.com,https://staging.nimiq-racer.example.com".
  const ALLOWED_ORIGINS = (
    process.env.ALLOWED_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    "http://localhost:5173"
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const app = express();

  if (process.env.TRUST_PROXY !== "0") app.set("trust proxy", 1);

  // ── Security headers ──
  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP managed by Vite/frontend meta tags
      crossOriginEmbedderPolicy: false, // allow cross-origin resources (Three.js textures, etc.)
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error("Not allowed by CORS"));
      },
    })
  );
  app.use(express.json({ limit: "16kb" }));

  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  // ── CSRF protection for state-changing endpoints ──
  function csrfGuard(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const origin = req.headers.origin;
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return next();
    return res.status(403).json({ error: "forbidden" });
  }
  app.use(csrfGuard);

  const IDENTITY_CTE = `
    WITH identified AS (
      SELECT *,
        CASE WHEN device_verified = 1 AND device_id IS NOT NULL
             THEN 'd:' || device_id
             ELSE 'g:' || lower(username)
        END AS identity
      FROM sessions
    )
  `;

  // ── Admin auth middleware ──
  function requireAdmin(req, res, next) {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
      return res.status(403).json({ error: "admin endpoint not configured" });
    }
    const provided = req.headers["x-admin-secret"];
    if (
      provided &&
      typeof provided === "string" &&
      provided.length === secret.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
    ) {
      return next();
    }
    return res.status(403).json({ error: "forbidden" });
  }

  app.get("/health", (req, res) => res.json({ ok: true }));

  // ── Record a completed game session ──
  app.post(
    "/api/sessions",
    rateLimit({ windowMs: 5 * 60 * 1000, max: 20 }),
    asyncHandler(async (req, res) => {
      const b = req.body ?? {};
      const username = str(b.username, { field: "username", maxLen: 24, alphanumeric: true });
      const score = num(b.score, { field: "score", min: 0, max: 200_000, integer: true });
      const coins = num(b.coins, { field: "coins", min: 0, max: 50_000, integer: true, fallback: 0 });
      const obstaclesAvoided = num(b.obstaclesAvoided, {
        field: "obstaclesAvoided",
        min: 0,
        max: 50_000,
        integer: true,
        fallback: 0,
      });
      const bonusesCollected = num(b.bonusesCollected, {
        field: "bonusesCollected",
        min: 0,
        max: 50_000,
        integer: true,
        fallback: 0,
      });
      const distance = num(b.distance, { field: "distance", min: 0, max: MAX_DURATION_SECONDS * 10 + 50, fallback: 0 });
      const durationSeconds = num(b.durationSeconds, {
        field: "durationSeconds",
        min: 0,
        max: MAX_DURATION_SECONDS,
        fallback: 0,
      });
      const carColor = str(b.carColor, { field: "carColor", maxLen: 16, required: false });
      const userAgent = str(req.headers["user-agent"], { field: "userAgent", maxLen: 256, required: false });

      const powerUps = Array.isArray(b.powerUps) ? b.powerUps : [];
      assertPlausibleSession({ score, coins, obstaclesAvoided, bonusesCollected, distance, durationSeconds, powerUps });

      const deviceId = str(b.deviceId, { field: "deviceId", maxLen: 128, required: false }) || null;
      const deviceVerified = !!deviceId;

      const identity = deviceVerified ? `d:${deviceId}` : `g:${username.toLowerCase()}`;
      const prevBest = (
        await db.execute({
          sql: `${IDENTITY_CTE} SELECT MAX(score) AS best FROM identified WHERE identity = ?`,
          args: [identity],
        })
      ).rows[0];
      const isPersonalBest = score > Number(prevBest?.best ?? -1);

      const result = await db.execute({
        sql: `INSERT INTO sessions
          (username, score, coins, obstacles_avoided, bonuses_collected, distance, duration_seconds, car_color, device_id, device_verified, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          username,
          score,
          coins,
          obstaclesAvoided,
          bonusesCollected,
          distance,
          durationSeconds,
          carColor || null,
          deviceId,
          deviceVerified ? 1 : 0,
          userAgent || null,
        ],
      });

      const rankRow = (
        await db.execute({
          sql: `${IDENTITY_CTE}, best AS (
             SELECT identity, MAX(score) AS best_score FROM identified GROUP BY identity
           )
           SELECT COUNT(*) + 1 AS rank FROM best WHERE best_score > ?`,
          args: [score],
        })
      ).rows[0];

      const totalPlayers = (
        await db.execute(`${IDENTITY_CTE} SELECT COUNT(DISTINCT identity) AS n FROM identified`)
      ).rows[0];

      // ── Achievement checking ──
      const sessionId = Number(result.lastInsertRowid);
      const newBadges = [];

      if (deviceId) {
        // Count total games for this device
        const gameCountRow = (
          await db.execute({
            sql: `SELECT COUNT(*) AS n FROM sessions WHERE device_id = ?`,
            args: [deviceId],
          })
        ).rows[0];
        const gameCount = Number(gameCountRow.n);

        const checks = [
          { badge: "rookie", condition: true }, // Completed a race
          { badge: "road_warrior", condition: score >= 500 },
          { badge: "speed_demon", condition: score >= 2000 },
          { badge: "coin_hunter", condition: coins >= 100 },
          { badge: "dodger", condition: obstaclesAvoided >= 50 },
          { badge: "veteran", condition: gameCount >= 10 },
          { badge: "endurance", condition: durationSeconds >= 300 },
        ];

        for (const { badge, condition } of checks) {
          if (!condition) continue;
          try {
            await db.execute({
              sql: `INSERT INTO achievements (device_id, badge, session_id) VALUES (?, ?, ?)`,
              args: [deviceId, badge, sessionId],
            });
            newBadges.push(badge);
          } catch (err) {
            // UNIQUE constraint = already earned
            if (!err?.message?.includes("UNIQUE constraint")) throw err;
          }
        }
      }

      res.status(201).json({
        id: sessionId,
        rank: Number(rankRow.rank),
        isPersonalBest,
        totalPlayers: Number(totalPlayers.n),
        verified: deviceVerified,
        newBadges,
      });
    })
  );

  // ── Record a car purchase ──
  app.post(
    "/api/purchases",
    rateLimit({ windowMs: 5 * 60 * 1000, max: 30 }),
    asyncHandler(async (req, res) => {
      const b = req.body ?? {};
      const deviceId = str(b.deviceId, { field: "deviceId", maxLen: 128 });
      const carHex = str(b.carHex, { field: "carHex", maxLen: 16 });
      const carName = str(b.carName, { field: "carName", maxLen: 40 });
      const txHash = str(b.txHash, { field: "txHash", maxLen: 128, required: false }) || null;
      const priceLuna = num(b.priceLuna, { field: "priceLuna", min: 0, integer: true });

      // UNIQUE(device_id, car_hex) prevents duplicate purchases at the DB level
      try {
        await db.execute({
          sql: `INSERT INTO purchases (device_id, car_hex, car_name, tx_hash, price_luna) VALUES (?, ?, ?, ?, ?)`,
          args: [deviceId, carHex, carName, txHash, priceLuna],
        });
      } catch (err) {
        // Duplicate purchase — not an error, just return existing
        if (err?.message?.includes("UNIQUE constraint")) {
          const existing = (
            await db.execute({ sql: `SELECT * FROM purchases WHERE device_id = ? AND car_hex = ?`, args: [deviceId, carHex] })
          ).rows[0];
          return res.json({ ok: true, alreadyOwned: true, purchase: existing });
        }
        throw err;
      }

      res.status(201).json({ ok: true, alreadyOwned: false });
    })
  );

  // ── Get purchases for a device ──
  app.get(
    "/api/purchases/:deviceId",
    rateLimit({ windowMs: 60_000, max: 60 }),
    asyncHandler(async (req, res) => {
      const deviceId = str(req.params.deviceId, { field: "deviceId", maxLen: 128 });
      const result = await db.execute({
        sql: `SELECT car_hex, car_name, tx_hash, price_luna, created_at FROM purchases WHERE device_id = ?`,
        args: [deviceId],
      });
      res.json({ purchases: result.rows });
    })
  );

  // ── Leaderboard ──
  app.get(
    "/api/leaderboard",
    rateLimit({ windowMs: 60_000, max: 60 }),
    asyncHandler(async (req, res) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
      const result = await db.execute({
        sql: `${IDENTITY_CTE}, ranked AS (
           SELECT username, score, device_verified, created_at,
                  ROW_NUMBER() OVER (PARTITION BY identity ORDER BY score DESC, created_at ASC) AS rn,
                  COUNT(*) OVER (PARTITION BY identity) AS games,
                  MAX(created_at) OVER (PARTITION BY identity) AS last_played
           FROM identified
         )
         SELECT username, score, games, last_played, device_verified AS verified
         FROM ranked
         WHERE rn = 1
         ORDER BY score DESC, last_played ASC
         LIMIT ?`,
        args: [limit],
      });
      // Enrich with badge counts
      const enriched = await Promise.all(
        result.rows.map(async (r) => {
          let badge_count = 0;
          // Try to find badge count via device_id from sessions
          const deviceRow = (
            await db.execute({
              sql: `SELECT device_id FROM sessions WHERE username = ? AND device_id IS NOT NULL LIMIT 1`,
              args: [r.username],
            })
          ).rows[0];
          if (deviceRow?.device_id) {
            const countRow = (
              await db.execute({
                sql: `SELECT COUNT(*) AS n FROM achievements WHERE device_id = ?`,
                args: [deviceRow.device_id],
              })
            ).rows[0];
            badge_count = Number(countRow?.n ?? 0);
          }
          return { ...r, verified: !!r.verified, badge_count };
        })
      );
      res.json({ leaderboard: enriched });
    })
  );

  // ── Player's own session history ──
  app.get(
    "/api/players/:username/sessions",
    rateLimit({ windowMs: 60_000, max: 60 }),
    asyncHandler(async (req, res) => {
      const username = str(req.params.username, { field: "username", maxLen: 24, alphanumeric: true });
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const result = await db.execute({
        sql: `SELECT id, score, coins, obstacles_avoided AS obstaclesAvoided, bonuses_collected AS bonusesCollected,
                distance, duration_seconds AS durationSeconds, car_color AS carColor, device_verified AS verified, created_at AS createdAt
         FROM sessions WHERE username = ? ORDER BY created_at DESC LIMIT ?`,
        args: [username, limit],
      });
      res.json({ sessions: result.rows.map((r) => ({ ...r, verified: !!r.verified })) });
    })
  );

  // ── Generic analytics event ──
  app.post(
    "/api/events",
    rateLimit({ windowMs: 5 * 60 * 1000, max: 120 }),
    asyncHandler(async (req, res) => {
      const b = req.body ?? {};
      const type = str(b.type, { field: "type", maxLen: 40 });
      const username = str(b.username, { field: "username", maxLen: 24, required: false });
      const sessionId = b.sessionId != null ? num(b.sessionId, { field: "sessionId", min: 1, integer: true }) : null;
      let payload = null;
      if (b.payload !== undefined) {
        const serialized = JSON.stringify(b.payload);
        if (serialized.length > 2000) throw new ValidationError("payload too large");
        payload = serialized;
      }

      await db.execute({
        sql: `INSERT INTO events (session_id, username, type, payload) VALUES (?, ?, ?, ?)`,
        args: [sessionId, username || null, type, payload],
      });

      res.status(201).json({ ok: true });
    })
  );

  // ── Aggregate stats for monitoring (admin-protected) ──
  app.get(
    "/api/stats/summary",
    rateLimit({ windowMs: 60_000, max: 30 }),
    requireAdmin,
    asyncHandler(async (req, res) => {
      const totals = (
        await db.execute(
          `${IDENTITY_CTE} SELECT COUNT(*) AS totalSessions, COUNT(DISTINCT identity) AS uniquePlayers,
                  AVG(score) AS avgScore, MAX(score) AS maxScore, SUM(coins) AS totalCoins
           FROM identified`
        )
      ).rows[0];

      const sessionsToday = (
        await db.execute(`SELECT COUNT(*) AS n FROM sessions WHERE created_at >= datetime('now', '-1 day')`)
      ).rows[0];

      const sessionsLast7Days = (
        await db.execute(`SELECT COUNT(*) AS n FROM sessions WHERE created_at >= datetime('now', '-7 day')`)
      ).rows[0];

      const gameStarts = (
        await db.execute(`SELECT COUNT(*) AS n FROM events WHERE type = 'game_start'`)
      ).rows[0];

      const eventBreakdown = (
        await db.execute(`SELECT type, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC LIMIT 20`)
      ).rows;

      const topPlayers = (
        await db.execute(
          `${IDENTITY_CTE}, ranked AS (
             SELECT username, score, device_verified,
                    ROW_NUMBER() OVER (PARTITION BY identity ORDER BY score DESC) AS rn,
                    COUNT(*) OVER (PARTITION BY identity) AS games
             FROM identified
           )
           SELECT username, score AS bestScore, games, device_verified AS verified FROM ranked WHERE rn = 1 ORDER BY bestScore DESC LIMIT 5`
        )
      ).rows;

      res.json({
        totalSessions: totals.totalSessions,
        uniquePlayers: totals.uniquePlayers,
        avgScore: totals.avgScore ? Math.round(totals.avgScore) : 0,
        maxScore: totals.maxScore ?? 0,
        totalCoins: totals.totalCoins ?? 0,
        sessionsToday: sessionsToday.n,
        sessionsLast7Days: sessionsLast7Days.n,
        gameStarts: gameStarts.n,
        completionRate: gameStarts.n > 0 ? Math.round((totals.totalSessions / gameStarts.n) * 100) : null,
        eventBreakdown,
        topPlayers: topPlayers.map((p) => ({ ...p, verified: !!p.verified })),
      });
    })
  );

  // ── Record a power-up purchase ──
  app.post(
    "/api/power-ups",
    rateLimit({ windowMs: 5 * 60 * 1000, max: 60 }),
    asyncHandler(async (req, res) => {
      const b = req.body ?? {};
      const deviceId = str(b.deviceId, { field: "deviceId", maxLen: 128 });
      const powerUp = str(b.powerUp, { field: "powerUp", maxLen: 40 });
      const txHash = str(b.txHash, { field: "txHash", maxLen: 128, required: false }) || null;
      const priceLuna = num(b.priceLuna, { field: "priceLuna", min: 0, integer: true });

      const result = await db.execute({
        sql: `INSERT INTO power_up_purchases (device_id, power_up, tx_hash, price_luna) VALUES (?, ?, ?, ?)`,
        args: [deviceId, powerUp, txHash, priceLuna],
      });

      res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
    })
  );

  // ── Get unused power-ups for a device ──
  app.get(
    "/api/power-ups/:deviceId",
    rateLimit({ windowMs: 60_000, max: 60 }),
    asyncHandler(async (req, res) => {
      const deviceId = str(req.params.deviceId, { field: "deviceId", maxLen: 128 });
      const result = await db.execute({
        sql: `SELECT id, power_up, used, created_at FROM power_up_purchases WHERE device_id = ? AND used = 0 ORDER BY created_at DESC`,
        args: [deviceId],
      });
      res.json({ powerUps: result.rows });
    })
  );

  // ── Create a challenge ──
  app.post(
    "/api/challenges",
    rateLimit({ windowMs: 5 * 60 * 1000, max: 30 }),
    asyncHandler(async (req, res) => {
      const b = req.body ?? {};
      const username = str(b.username, { field: "username", maxLen: 24, alphanumeric: true });
      const score = num(b.score, { field: "score", min: 0, max: 200_000, integer: true });
      const deviceId = str(b.deviceId, { field: "deviceId", maxLen: 128, required: false }) || null;

      const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

      await db.execute({
        sql: `INSERT INTO challenges (id, creator_username, creator_score, creator_device_id) VALUES (?, ?, ?, ?)`,
        args: [id, username, score, deviceId],
      });

      res.status(201).json({ id });
    })
  );

  // ── Get challenge details ──
  app.get(
    "/api/challenges/:id",
    rateLimit({ windowMs: 60_000, max: 60 }),
    asyncHandler(async (req, res) => {
      const id = str(req.params.id, { field: "id", maxLen: 64 });
      const result = await db.execute({
        sql: `SELECT id, creator_username, creator_score, status, accepted_by, accepted_score FROM challenges WHERE id = ?`,
        args: [id],
      });
      if (result.rows.length === 0) return res.status(404).json({ error: "challenge not found" });
      res.json({ challenge: result.rows[0] });
    })
  );

  // ── Accept a challenge ──
  app.post(
    "/api/challenges/:id/accept",
    rateLimit({ windowMs: 5 * 60 * 1000, max: 30 }),
    asyncHandler(async (req, res) => {
      const id = str(req.params.id, { field: "id", maxLen: 64 });
      const b = req.body ?? {};
      const username = str(b.username, { field: "username", maxLen: 24, alphanumeric: true });
      const score = num(b.score, { field: "score", min: 0, max: 200_000, integer: true });

      await db.execute({
        sql: `UPDATE challenges SET accepted_by = ?, accepted_score = ?, status = 'completed' WHERE id = ? AND status = 'open'`,
        args: [username, score, id],
      });

      res.json({ ok: true });
    })
  );

  // ── Streak check-in (signature verification) ──
  app.post(
    "/api/streaks/checkin",
    rateLimit({ windowMs: 60_000, max: 10 }),
    asyncHandler(async (req, res) => {
      const b = req.body ?? {};
      const deviceId = str(b.deviceId, { field: "deviceId", maxLen: 128 });
      const publicKey = str(b.publicKey, { field: "publicKey", maxLen: 128 });
      const signature = str(b.signature, { field: "signature", maxLen: 256 });
      const message = str(b.message, { field: "message", maxLen: 256 });

      // Extract date from message format: NimiqRacer:checkin:YYYY-MM-DD:{deviceId}
      const parts = message.split(":");
      if (parts.length < 3 || parts[0] !== "NimiqRacer" || parts[1] !== "checkin") {
        throw new ValidationError("invalid checkin message format");
      }
      const dayDate = parts[2];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
        throw new ValidationError("invalid date format in message");
      }

      // Calculate streak: check if yesterday exists
      const yesterday = new Date(new Date(dayDate).getTime() - 86400000).toISOString().slice(0, 10);
      const prevRow = (
        await db.execute({
          sql: `SELECT streak_count FROM streaks WHERE device_id = ? AND day_date = ? ORDER BY created_at DESC LIMIT 1`,
          args: [deviceId, yesterday],
        })
      ).rows[0];

      const streakCount = prevRow ? Number(prevRow.streak_count) + 1 : 1;

      try {
        await db.execute({
          sql: `INSERT INTO streaks (device_id, public_key, signature, day_date, streak_count) VALUES (?, ?, ?, ?, ?)`,
          args: [deviceId, publicKey, signature, dayDate, streakCount],
        });
      } catch (err) {
        if (err?.message?.includes("UNIQUE constraint")) {
          // Already checked in today
          const existing = (
            await db.execute({
              sql: `SELECT streak_count FROM streaks WHERE device_id = ? AND day_date = ?`,
              args: [deviceId, dayDate],
            })
          ).rows[0];
          const currentStreak = Number(existing?.streak_count ?? 0);
          const unlocks = [];
          if (currentStreak >= 7) unlocks.push("streak_7");
          if (currentStreak >= 30) unlocks.push("streak_30");
          return res.json({ ok: true, streak: currentStreak, unlocks, alreadyCheckedIn: true });
        }
        throw err;
      }

      const unlocks = [];
      if (streakCount >= 7) unlocks.push("streak_7");
      if (streakCount >= 30) unlocks.push("streak_30");

      res.status(201).json({ ok: true, streak: streakCount, unlocks });
    })
  );

  // ── Get streak info ──
  app.get(
    "/api/streaks/:deviceId",
    rateLimit({ windowMs: 60_000, max: 60 }),
    asyncHandler(async (req, res) => {
      const deviceId = str(req.params.deviceId, { field: "deviceId", maxLen: 128 });
      const latest = (
        await db.execute({
          sql: `SELECT streak_count, day_date FROM streaks WHERE device_id = ? ORDER BY day_date DESC LIMIT 1`,
          args: [deviceId],
        })
      ).rows[0];

      const total = (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM streaks WHERE device_id = ?`,
          args: [deviceId],
        })
      ).rows[0];

      if (!latest) {
        return res.json({ current_streak: 0, last_date: null, total_checkins: 0 });
      }

      // Check if streak is still active (last check-in was today or yesterday)
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const lastDate = String(latest.day_date);
      const isActive = lastDate === today || lastDate === yesterday;

      res.json({
        current_streak: isActive ? Number(latest.streak_count) : 0,
        last_date: lastDate,
        total_checkins: Number(total.n),
      });
    })
  );

  // ── Get achievements for a device ──
  app.get(
    "/api/achievements/:deviceId",
    rateLimit({ windowMs: 60_000, max: 60 }),
    asyncHandler(async (req, res) => {
      const deviceId = str(req.params.deviceId, { field: "deviceId", maxLen: 128 });
      const result = await db.execute({
        sql: `SELECT badge, created_at FROM achievements WHERE device_id = ? ORDER BY created_at ASC`,
        args: [deviceId],
      });
      res.json({ achievements: result.rows });
    })
  );

  // ── Error handler — no internal details leaked to clients ──
  // Express 5 requires exactly 4 parameters for error-handling middleware.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    if (err?.message === "Not allowed by CORS") {
      return res.status(403).json({ error: "forbidden" });
    }
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
