import { describe, test, expect } from "bun:test";
import { DEFAULT_CONFIG, DONE_TOKEN } from "../types.js";

describe("types", () => {
  test("DEFAULT_CONFIG has expected shape", () => {
    expect(DEFAULT_CONFIG.defaultModel).toBe("");
    expect(DEFAULT_CONFIG.defaultThinking).toBe("off");
    expect(DEFAULT_CONFIG.defaultMaxIter).toBe(50);
  });

  test("DONE_TOKEN is the expected XML tag", () => {
    expect(DONE_TOKEN).toBe("<ralph>DONE</ralph>");
  });
});
