import { ValidationError } from "./validate.js";

/**
 * Server-side plausibility checks for game session data.
 *
 * LIMITATION: All game state (score, coins, obstacles, distance, duration) is
 * authoritative on the client. A motivated attacker can craft payloads that pass
 * every check here as long as the numbers are internally consistent. These
 * checks catch casual / automated cheating but cannot replace a server-authoritative
 * game loop. Treat leaderboard rankings as "best-effort" until a relay-based or
 * ZK-proof architecture is adopted.
 */

// These bounds are derived from the actual scoring rules in
// src/components/EnhancedCarRaceGame.tsx:
//   coin +10, obstacle avoided +5, bonus box +30, distance points: floor(distance/20)
// Generously padded so legitimate skilled play is never rejected.
export const MAX_DURATION_SECONDS = 3600; // 1 hour is already an absurdly long single run
const MAX_COINS_PER_SECOND = 8;
const MAX_OBSTACLES_PER_SECOND = 5;
const MAX_BONUSES_PER_3_SECONDS = 1;
const MAX_SCORE_PER_SECOND = 25;

// Achievement badge definitions (used by app.js for checking)
export const ACHIEVEMENT_DEFS = [
  { badge: "rookie", name: "Rookie", criteria: "Complete 1 race" },
  { badge: "road_warrior", name: "Road Warrior", criteria: "Score 500+ in a single run" },
  { badge: "speed_demon", name: "Speed Demon", criteria: "Score 2000+ in a single run" },
  { badge: "coin_hunter", name: "Coin Hunter", criteria: "Collect 100+ coins in one run" },
  { badge: "dodger", name: "Dodger", criteria: "Avoid 50+ obstacles in one run" },
  { badge: "veteran", name: "Veteran", criteria: "Play 10 games" },
  { badge: "endurance", name: "Endurance", criteria: "Survive 5+ minutes in one run" },
];

export function assertPlausibleSession({
  score,
  coins,
  obstaclesAvoided,
  bonusesCollected,
  distance,
  durationSeconds,
  powerUps,
}) {
  // distance is derived purely from elapsed time in the client (Math.floor(elapsedMs / 100)),
  // so it must track duration almost exactly regardless of how the run was played.
  const expectedDistance = durationSeconds * 10;
  const distanceTolerance = Math.max(5, expectedDistance * 0.15);
  if (Math.abs(distance - expectedDistance) > distanceTolerance) {
    throw new ValidationError("distance is inconsistent with duration");
  }

  // Power-up adjustments
  const activePowerUps = Array.isArray(powerUps) ? powerUps : [];
  const hasHeadStart = activePowerUps.includes("head_start");
  const hasCoinMagnet = activePowerUps.includes("coin_magnet");
  const headStartBonus = hasHeadStart ? 150 : 0;

  // Score is the sum of its components: coins, obstacles, bonuses, plus passive
  // distance-based points (1 point per 20 distance units driven), plus head start bonus.
  const distancePoints = Math.floor(distance / 20);
  const expectedScore = coins * 10 + obstaclesAvoided * 5 + bonusesCollected * 30 + distancePoints + headStartBonus;
  if (score !== expectedScore) {
    throw new ValidationError("score does not match reported coins/obstacles/bonuses");
  }

  // Coin magnet allows ~2x collection rate
  const coinRateMultiplier = hasCoinMagnet ? 2 : 1;
  if (coins > durationSeconds * MAX_COINS_PER_SECOND * coinRateMultiplier + 5) {
    throw new ValidationError("coins collected implausible for run duration");
  }
  if (obstaclesAvoided > durationSeconds * MAX_OBSTACLES_PER_SECOND + 5) {
    throw new ValidationError("obstacles avoided implausible for run duration");
  }
  if (bonusesCollected > durationSeconds / (3 * MAX_BONUSES_PER_3_SECONDS) + 2) {
    throw new ValidationError("bonuses collected implausible for run duration");
  }
  // Extra lives and head start can add to the score ceiling
  if (score > durationSeconds * MAX_SCORE_PER_SECOND + 50 + headStartBonus) {
    throw new ValidationError("score implausible for run duration");
  }
}
