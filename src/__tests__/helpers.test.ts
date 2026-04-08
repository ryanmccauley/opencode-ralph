import { describe, test, expect } from "bun:test";
import { parsePositiveInt, validatePositiveInt } from "../tui/helpers.js";

describe("parsePositiveInt", () => {
  test("parses valid positive integers", () => {
    expect(parsePositiveInt("10", 50)).toBe(10);
    expect(parsePositiveInt("1", 50)).toBe(1);
    expect(parsePositiveInt("999", 50)).toBe(999);
  });

  test("returns fallback for non-numeric strings", () => {
    expect(parsePositiveInt("abc", 50)).toBe(50);
    expect(parsePositiveInt("", 50)).toBe(50);
  });

  test("returns fallback for zero and negative numbers", () => {
    expect(parsePositiveInt("0", 50)).toBe(50);
    expect(parsePositiveInt("-5", 50)).toBe(50);
  });

  test("handles float strings by truncating", () => {
    expect(parsePositiveInt("3.7", 50)).toBe(3);
  });
});

describe("validatePositiveInt", () => {
  test("returns undefined for valid positive integers", () => {
    expect(validatePositiveInt("1")).toBeUndefined();
    expect(validatePositiveInt("50")).toBeUndefined();
  });

  test("returns error message for invalid input", () => {
    expect(validatePositiveInt("")).toBe("Enter a positive number");
    expect(validatePositiveInt("0")).toBe("Enter a positive number");
    expect(validatePositiveInt("-1")).toBe("Enter a positive number");
    expect(validatePositiveInt("abc")).toBe("Enter a positive number");
    expect(validatePositiveInt(undefined)).toBe("Enter a positive number");
  });
});
