# Nimiq Racer

A lightweight 3D racing game built with React, Three.js, and TypeScript. Designed for smooth 60fps gameplay on both desktop and mobile, with Nimiq Pay Mini App integration for in-game purchases.

## Gameplay

Race down an endless highway, dodging obstacles and collecting bonuses to rack up points.

- **3-lane system** — switch lanes to avoid traffic cones, barriers, and stalled cars
- **Bonus boxes** (green) — collect for +30 points
- **Golden keys** — temporary invisibility power-up
- **Coin streaks** — ride through coin lanes for +10 each
- **Speed boost pads** — hit cyan pads for a temporary speed surge
- **Construction zones** — narrowed road sections to test precision
- **Overpasses** — scenic concrete bridges overhead
- Speed increases gradually as you survive longer
- **Cosmetic shop** — unlock premium car skins by paying NIM
- **Global leaderboard** — every run is submitted to the backend; see your rank on the game-over screen or browse the top 10 from the main menu

## Controls

| Input | Action |
|-------|--------|
| Arrow Left/Right or A/D | Switch lanes |
| Arrow Up/Down or W/S | Speed up / slow down |
| Mouse movement | Steer between lanes |
| Mobile tap (left/right) | Switch lanes |

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

The game runs standalone without a backend — the leaderboard panel will just show a
connection error until the analytics server (below) is running. The cosmetic shop
requires running inside Nimiq Pay.

## Nimiq Pay Integration

Nimiq Racer is built as a [Nimiq Mini App](https://nimiq.dev/mini-apps/) using `@nimiq/mini-app-sdk`.

**Features:**
- **Cosmetic shop** — 3 free cars + 3 premium cars purchasable with NIM
- **Device identity** — Nimiq Pay provides a per-origin device identifier for leaderboard verification
- **Graceful degradation** — the game works in any browser; shop and device verification only activate inside Nimiq Pay

**Setup:**
1. Set `VITE_NIM_RECIPIENT_ADDRESS` in `.env` to your NIM address (receives shop payments)
2. Optionally adjust `VITE_CAR_PRICE_LUNA` (default: 100000 = 1 NIM per car)
3. Build and deploy to HTTPS hosting
4. Open the deployed URL inside Nimiq Pay to test purchases

**Testing in Nimiq Pay:**
1. Deploy to any HTTPS host, or run `npm run dev` locally and expose it via a tunnel (e.g. `ngrok http 5173`)
2. On your phone, open the deeplink: `https://nimpay.app/miniapps/open/<your-host>` (e.g. `https://nimpay.app/miniapps/open/abc123.ngrok.io`)
   - Or use the custom scheme: `nimiqpay://miniapp?url=<your-host>`
3. Nimiq Pay will show a warning for unrecognized URLs, then load the app with full SDK access
4. To test with free NIM: open Nimiq Pay settings, long-press the settings button for ~10 seconds to unlock the dev menu, switch to **Testnet**, then tap "Get free NIM" to receive 110,000 test NIM

**Testing outside Nimiq Pay:**
The game loads normally in any browser. Premium cars will show prices but purchasing will
display "Shop unavailable — open in Nimiq Pay" since the SDK requires the Nimiq Pay host.

## Analytics & Leaderboard Backend

`server/` is a small Express + SQLite API that records completed runs and serves a
global leaderboard. It's optional for local play but required for the leaderboard
and rank-on-game-over features to work.

```bash
cd server
npm install
npm run dev
```

This starts the API on `http://localhost:8787` (override with `PORT`) and creates
`server/data/nimiq-racer.sqlite` on first run. Then, in the project root, copy
`.env.example` to `.env` (defaults already point at `http://localhost:8787`) and
run `npm run dev` as usual.

**Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/sessions` | Record a completed run (score, coins, distance, duration, car color) |
| `GET`  | `/api/leaderboard?limit=10` | Best score per player, ranked |
| `GET`  | `/api/players/:username/sessions` | A player's run history |
| `POST` | `/api/events` | Generic analytics event (e.g. `game_start`) |
| `GET`  | `/api/stats/summary` | Aggregate stats for monitoring |
| `GET`  | `/health` | Liveness check |

### Leaderboard integrity

- **Anti-cheat validation** (`server/src/antiCheat.js`) — every submitted score must
  exactly match `coins*10 + obstaclesAvoided*5 + bonusesCollected*30` (the game's real
  scoring formula), and `distance` must track `durationSeconds` the way the client
  actually computes it. Implausible submissions are rejected with `400`.
- **Device-verified identity** — when running inside Nimiq Pay, the SDK provides a
  per-origin device identifier. Submissions with a device ID get a verified badge on
  the leaderboard (shown as a checkmark in the UI). Players without a device ID still
  play and submit scores normally as unverified guest entries keyed by username.

### Deploying the backend

`server/Dockerfile` builds a container image; mount a persistent volume at `/app/data`
for the SQLite database.

```bash
cd server
docker build -t nimiq-racer-server .
docker run -p 8787:8787 -v nimiq-racer-data:/app/data \
  -e ALLOWED_ORIGINS=https://your-frontend-domain.example \
  nimiq-racer-server
```

Config via environment variables:

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default `8787`) |
| `ALLOWED_ORIGINS` | Comma-separated list of frontend origins allowed by CORS |
| `TRUST_PROXY` | Set to `0` only if exposed directly with no reverse proxy |
| `ADMIN_SECRET` | Secret for admin stats endpoint |

## Build for Production

```bash
npm run build
npm run preview
```

Output goes to `dist/`. Deploy the contents of `dist/` to any HTTPS static hosting.

## Testing

```bash
npm test                # frontend: vitest
cd server && npm test    # backend: node's built-in test runner
```

## Tech Stack

- **React 19** + TypeScript
- **Three.js** — 3D rendering
- **Vite** — dev server and bundler
- **@nimiq/mini-app-sdk** — Nimiq Pay Mini App integration (payments, device identity)

## Architecture

```
src/
├── main.tsx                    # Entry point
├── App.tsx                     # Username → car select (with shop) → game flow
├── nimiq.ts                    # Nimiq SDK wrapper + React context/hook
├── services/
│   └── api.ts                  # Backend API client (sessions, leaderboard, events)
├── utils/
│   ├── color.ts                # Numeric car color → hex string
│   └── gameAudio.ts            # Game audio manager
└── components/
    ├── EnhancedCarRaceGame.tsx  # Core game (Three.js scene, controls, HUD), lazy-loaded
    ├── Leaderboard.tsx          # Global leaderboard panel
    ├── Dashboard.tsx            # Admin stats dashboard
    └── ErrorBoundary.tsx        # Error fallback UI

server/                          # Analytics + leaderboard API (Express + SQLite)
├── src/
│   ├── index.js                 # Entry point, DB init, graceful shutdown
│   ├── app.js                   # Express routes + middleware
│   ├── db.js                    # SQLite schema + connection
│   ├── validate.js              # Request validation helpers
│   ├── antiCheat.js             # Score plausibility checks
│   └── rateLimit.js             # Per-IP rate limiter
├── test/                        # node:test suite
├── deploy/                      # Dockerfile, PM2 config, Caddy example
└── data/                        # SQLite file (gitignored)
```

## License

MIT
