import { describe, test, expect } from "bun:test";
import { toYaml } from "../core/agent.js";

describe("toYaml", () => {
  test("serializes a simple string", () => {
    expect(toYaml("hello")).toBe("hello");
  });

  test("quotes strings that look like booleans", () => {
    expect(toYaml("true")).toBe('"true"');
    expect(toYaml("false")).toBe('"false"');
  });

  test("quotes strings that look like null", () => {
    expect(toYaml("null")).toBe('"null"');
  });

  test("quotes strings starting with digits", () => {
    expect(toYaml("123abc")).toBe('"123abc"');
  });

  test("quotes strings with special chars", () => {
    expect(toYaml("#FFFFFF")).toBe('"#FFFFFF"');
  });

  test("serializes numbers", () => {
    expect(toYaml(42)).toBe("42");
    expect(toYaml(0.7)).toBe("0.7");
  });

  test("serializes booleans", () => {
    expect(toYaml(true)).toBe("true");
    expect(toYaml(false)).toBe("false");
  });

  test("serializes null", () => {
    expect(toYaml(null)).toBe("null");
    expect(toYaml(undefined)).toBe("null");
  });

  test("serializes empty object", () => {
    expect(toYaml({})).toBe("{}");
  });

  test("serializes empty array", () => {
    expect(toYaml([])).toBe("[]");
  });

  test("serializes flat object", () => {
    const result = toYaml({ mode: "primary", temperature: 0.7 });
    expect(result).toContain("mode: primary");
    expect(result).toContain("temperature: 0.7");
  });

  test("serializes nested object", () => {
    const result = toYaml({
      thinking: { type: "enabled", budgetTokens: 8000 },
    });
    expect(result).toContain("thinking:");
    expect(result).toContain("  type: enabled");
    expect(result).toContain("  budgetTokens: 8000");
  });

  test("serializes permission-like structure", () => {
    const result = toYaml({
      permission: {
        edit: "allow",
        bash: { "*": "allow" },
      },
    });
    expect(result).toContain("permission:");
    expect(result).toContain("  edit: allow");
    expect(result).toContain("  bash:");
    expect(result).toContain('    *: allow');
  });
});
