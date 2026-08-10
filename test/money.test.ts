import { describe, expect, it } from "vitest";

import { decimalToMinor, minorToDecimal } from "../src/spliit/money";

describe("currency amount conversion", () => {
  it("converts two-decimal currencies exactly", () => {
    expect(decimalToMinor("12.50", 2)).toBe(1250);
    expect(decimalToMinor("12.5", 2)).toBe(1250);
    expect(minorToDecimal(1250, 2)).toBe("12.50");
    expect(minorToDecimal(-5, 2)).toBe("-0.05");
  });

  it("supports zero- and three-decimal currencies", () => {
    expect(decimalToMinor("120", 0)).toBe(120);
    expect(minorToDecimal(120, 0)).toBe("120");
    expect(decimalToMinor("1.234", 3)).toBe(1234);
    expect(minorToDecimal(1234, 3)).toBe("1.234");
  });

  it("rejects unsupported precision, zero, and huge values", () => {
    expect(() => decimalToMinor("1.234", 2)).toThrow("at most 2");
    expect(() => decimalToMinor("0", 2)).toThrow("cannot be zero");
    expect(() => decimalToMinor("100000000", 2)).toThrow("supported range");
  });
});
