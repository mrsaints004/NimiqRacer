# Nimiq Racer

A 3D endless racing game that runs inside Nimiq Pay. Built on the Mini Apps Framework using `@nimiq/mini-app-sdk`. Works on desktop and mobile at 60fps.

**Live:** [nimiqracer.vercel.app](https://nimiqracer.vercel.app)

## What it does

You race down a highway, dodge obstacles, collect coins, and try to survive as long as possible. The game gets faster the longer you last.

### Core gameplay

- 3-lane highway with lane switching
- Obstacles: traffic cones, barriers, stalled cars
- Collectibles: coins (+10 pts), bonus boxes (+30 pts), golden keys (invisibility)
- Road events: speed boost pads, construction zones, overpasses, coin streak lanes
- 3 lives per run with crash freeze, camera shake, and respawn invincibility
- Difficulty ramps up over time (speed and obstacle frequency)

### Nimiq Pay integration

The game uses four SDK features:

1. **NIM payments** — 5 premium cars purchasable with NIM (1-2 NIM each). 3 cars are free.
2. **Device identity** — per-origin device ID for verified leaderboard entries (checkmark badge) and purchase tracking.
3. **Message signing** — Ed25519 signatures for daily streak check-ins, verified server-side.
4. **Graceful degradation** — everything except the shop and verification works in any browser. No Nimiq Pay required to play.

### Progression systems

- **Global leaderboard** — all players ranked by best score, scrollable, with medals for top 3.
- **Daily streaks** — check in daily (signed with your Nimiq key). 7-day streak unlocks the Streak Racer car. 30-day streak unlocks the Gold Racer.
- **Achievements** — 7 badges: Rookie, Road Warrior, Speed Demon, Coin Hunter, Dodger, Veteran, Endurance. Earned automatically and shown on game over.
- **Challenges** — after a run, generate a shareable link. Your friend opens it, plays, and the scores are compared. Uses the Web Share API on mobile.
- **Power-ups** — purchasable single-use boosts: Extra Life, Coin Magnet (2x coin radius for 30s), Head Start (+150 pts), Shield (absorbs first crash). Consumed after use.

### Controls

Desktop:
- A/D or Left/Right arrows — switch lanes
- W/S or Up/Down arrows — accelerate / brake
- P or Escape — pause

Mobile:
- Swipe left/right — switch lanes
- Hold bottom-right of screen — accelerate
- Hold bottom-left of screen — brake
- Tilt steering — optional gyroscope controls (toggle in top right)
- Haptic feedback on lane changes, crashes, coin pickups

### Audio

All sound is procedural using the Web Audio API. No external audio files. Engine hum, crash impacts, coin chimes, power-up sounds, and game over are all synthesized at runtime.

## How it uses the Mini Apps Framework

The SDK is loaded lazily (`src/nimiq.ts`). If the app detects it's running inside Nimiq Pay, it activates:

- `sendNimPayment()` for car and power-up purchases
- `getDeviceId()` for leaderboard verification and streak/purchase tracking
- `signMessage()` for daily streak check-ins (server verifies Ed25519 signatures)
- `getNimiqAccounts()` for account display

If the SDK isn't available (browser, testing), the game runs normally with the shop disabled.

## Backend

Express + SQLite API in `server/`. Handles:

- Score submission with anti-cheat validation (server recomputes the score formula and rejects implausible submissions)
- Leaderboard with per-identity deduplication (best score per device or username)
- Purchase and power-up tracking (marks power-ups as consumed after use)
- Daily streak storage with signature verification
- Achievement badge unlocking
- Challenge creation and resolution
- Rate limiting and input validation on all endpoints
- Hosted on Turso (remote SQLite) for production

## Running locally

```bash
# Frontend
npm install
npm run dev
# opens http://localhost:5173

# Backend (separate terminal)
cd server
npm install
npm run dev
# starts API on http://localhost:8787
```

Copy `.env.example` to `.env` in both the root and `server/` directories. The defaults work for local development.

## Testing

```bash
npm test              # frontend (vitest) — 5 tests
cd server && npm test # backend (node:test) — 15 tests
```

All tests pass. ESLint runs clean with zero errors.

## Production build

```bash
npm run build
```

Output goes to `dist/`. The backend is deployed via Docker (`server/Dockerfile`) or as a Vercel serverless function (`api/index.js` + `vercel.json`).

## Tech stack

- React 19, TypeScript, Vite 7
- Three.js for 3D rendering
- Web Audio API for procedural sound
- @nimiq/mini-app-sdk v0.1.0
- Express 5, SQLite (via @libsql/client / Turso)
- Vitest + node:test for testing

## License

MIT
