import { describe, it, expect } from "vitest";
import { toHexColor } from "./color";

describe("toHexColor", () => {
  it("converts a numeric color to a lowercase padded hex string", () => {
    expect(toHexColor(0x3388ff)).toBe("#3388ff");
  });

  it("pads short values to 6 digits", () => {
    expect(toHexColor(0xff)).toBe("#0000ff");
  });

  it("returns undefined when given undefined", () => {
    expect(toHexColor(undefined)).toBeUndefined();
  });
});
