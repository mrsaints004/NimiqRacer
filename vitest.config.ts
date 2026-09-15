import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // server/ has its own test suite run separately via `node --test` (node:test isn't a
    // vitest-compatible runner) — scope this to the frontend only.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
