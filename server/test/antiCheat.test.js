import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPlausibleSession } from "../src/antiCheat.js";
import { ValidationError } from "../src/validate.js";

const validSession = () => ({
  score: 220, // 10*10 + 8*5 + 2*30 + floor(400/20)
  coins: 10,
  obstaclesAvoided: 8,
  bonusesCollected: 2,
  distance: 400, // 40s * 10
  durationSeconds: 40,
});

test("accepts a plausible, internally-consistent session", () => {
  assert.doesNotThrow(() => assertPlausibleSession(validSession()));
});

test("rejects a score that doesn't match coins/obstacles/bonuses", () => {
  const s = { ...validSession(), score: 999 };
  assert.throws(() => assertPlausibleSession(s), ValidationError);
});

test("rejects distance inconsistent with duration", () => {
  const s = { ...validSession(), distance: 50_000 };
  assert.throws(() => assertPlausibleSession(s), ValidationError);
});

test("rejects implausible coin collection rate", () => {
  const s = { ...validSession(), coins: 1000, score: 1000 * 10 + 8 * 5 + 2 * 30 + Math.floor(400 / 20), distance: 400, durationSeconds: 40 };
  assert.throws(() => assertPlausibleSession(s), ValidationError);
});

test("rejects implausible obstacle-avoidance rate", () => {
  const obstaclesAvoided = 1000;
  const s = {
    ...validSession(),
    obstaclesAvoided,
    score: 10 * 10 + obstaclesAvoided * 5 + 2 * 30 + Math.floor(400 / 20),
  };
  assert.throws(() => assertPlausibleSession(s), ValidationError);
});

test("rejects an internally-consistent but implausibly fast overall score rate", () => {
  // Each component individually stays under its own per-second cap, but the combined score
  // for a 1-second run is still absurd — this is what the overall score-rate check catches.
  const s = {
    coins: 13,
    obstaclesAvoided: 10,
    bonusesCollected: 2,
    score: 13 * 10 + 10 * 5 + 2 * 30 + Math.floor(10 / 20), // 240
    distance: 10,
    durationSeconds: 1,
  };
  assert.throws(() => assertPlausibleSession(s), ValidationError);
});

test("accepts a zero-duration/zero-score session (edge case: instant crash)", () => {
  const s = { score: 0, coins: 0, obstaclesAvoided: 0, bonusesCollected: 0, distance: 0, durationSeconds: 0 };
  assert.doesNotThrow(() => assertPlausibleSession(s));
});
