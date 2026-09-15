import { describe, it, expect } from "vitest";
import type { SessionPayload } from "./api";

describe("SessionPayload", () => {
  it("accepts deviceId as an optional field", () => {
    const payload: SessionPayload = {
      username: "test",
      score: 100,
      coins: 10,
      obstaclesAvoided: 5,
      bonusesCollected: 0,
      distance: 100,
      durationSeconds: 10,
      deviceId: "abc123",
    };
    expect(payload.deviceId).toBe("abc123");
  });

  it("works without deviceId (guest play)", () => {
    const payload: SessionPayload = {
      username: "guest",
      score: 50,
      coins: 5,
      obstaclesAvoided: 2,
      bonusesCollected: 0,
      distance: 50,
      durationSeconds: 5,
    };
    expect(payload.deviceId).toBeUndefined();
  });
});
