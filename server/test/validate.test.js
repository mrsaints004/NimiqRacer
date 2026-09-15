import { test } from "node:test";
import assert from "node:assert/strict";
import { str, num, ValidationError } from "../src/validate.js";

test("str: required field missing throws", () => {
  assert.throws(() => str(undefined, { field: "username" }), ValidationError);
  assert.throws(() => str("", { field: "username" }), ValidationError);
  assert.throws(() => str("   ", { field: "username" }), ValidationError);
});

test("str: optional field missing returns fallback", () => {
  assert.equal(str(undefined, { field: "carColor", required: false }), "");
  assert.equal(str(undefined, { field: "carColor", required: false, fallback: "none" }), "none");
});

test("str: trims and truncates to maxLen", () => {
  assert.equal(str("  hi  ", { field: "username" }), "hi");
  assert.equal(str("a".repeat(50), { field: "username", maxLen: 10 }).length, 10);
});

test("str: rejects non-string input", () => {
  assert.throws(() => str(123, { field: "username" }), ValidationError);
});

test("num: applies fallback when missing", () => {
  assert.equal(num(undefined, { field: "score", fallback: 0 }), 0);
});

test("num: rejects non-numeric input", () => {
  assert.throws(() => num("abc", { field: "score" }), ValidationError);
});

test("num: enforces min/max range", () => {
  assert.throws(() => num(-1, { field: "score", min: 0 }), ValidationError);
  assert.throws(() => num(101, { field: "score", max: 100 }), ValidationError);
  assert.equal(num(50, { field: "score", min: 0, max: 100 }), 50);
});

test("num: enforces integer constraint", () => {
  assert.throws(() => num(1.5, { field: "score", integer: true }), ValidationError);
  assert.equal(num(2, { field: "score", integer: true }), 2);
});
