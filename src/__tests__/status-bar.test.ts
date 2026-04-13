import { describe, test, expect } from "bun:test";
import {
  formatElapsed,
  renderFooter,
  renderFooterAtTime,
  renderFooterParts,
  type StatusBarInfo,
} from "../tui/status-bar.js";

// ─── formatElapsed ───────────────────────────────────────────────────────────

describe("formatElapsed", () => {
  test("formats zero", () => {
    expect(formatElapsed(0)).toBe("0s");
  });

  test("formats seconds only", () => {
    expect(formatElapsed(1_000)).toBe("1s");
    expect(formatElapsed(42_000)).toBe("42s");
    expect(formatElapsed(59_000)).toBe("59s");
  });

  test("formats minutes and seconds", () => {
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(61_000)).toBe("1m 01s");
    expect(formatElapsed(90_000)).toBe("1m 30s");
    expect(formatElapsed(3 * 60_000 + 42_000)).toBe("3m 42s");
  });

  test("formats hours, minutes, and seconds", () => {
    expect(formatElapsed(3600_000)).toBe("1h 00m 00s");
    expect(formatElapsed(3600_000 + 5 * 60_000 + 12_000)).toBe("1h 05m 12s");
    expect(formatElapsed(2 * 3600_000 + 30 * 60_000)).toBe("2h 30m 00s");
  });

  test("truncates sub-second precision", () => {
    expect(formatElapsed(1_500)).toBe("1s");
    expect(formatElapsed(999)).toBe("0s");
  });

  test("clamps negative durations to zero", () => {
    expect(formatElapsed(-1)).toBe("0s");
    expect(formatElapsed(-10_000)).toBe("0s");
  });
});

// ─── renderFooterParts ───────────────────────────────────────────────────────

describe("renderFooterParts", () => {
  test("left contains iteration and elapsed time", () => {
    const info: StatusBarInfo = {
      iteration: 2,
      maxIter: 50,
      model: "anthropic/claude-sonnet-4",
      thinking: "high",
      startTime: 10_000,
    };

    const { left } = renderFooterParts(info, 15_000);

    expect(left).toContain("iter 2/50");
    expect(left).toContain("5s");
    expect(left).toContain("\u00b7");
  });

  test("right contains model and thinking value", () => {
    const info: StatusBarInfo = {
      iteration: 2,
      maxIter: 50,
      model: "anthropic/claude-sonnet-4",
      thinking: "high",
      startTime: 10_000,
    };

    const { right } = renderFooterParts(info, 15_000);

    expect(right).toContain("anthropic/claude-sonnet-4");
    expect(right).toContain("high");
    expect(right).toContain("\u00b7");
  });

  test("thinking off is included in right part", () => {
    const info: StatusBarInfo = {
      iteration: 1,
      maxIter: 10,
      model: "openai/gpt-4o",
      thinking: "off",
      startTime: Date.now(),
    };

    const { right } = renderFooterParts(info, info.startTime);

    expect(right).toContain("openai/gpt-4o");
    expect(right).toContain("off");
  });
});

// ─── renderFooter ────────────────────────────────────────────────────────────

describe("renderFooter", () => {
  test("renders all four fields", () => {
    const info: StatusBarInfo = {
      iteration: 2,
      maxIter: 50,
      model: "anthropic/claude-sonnet-4",
      thinking: "high",
      startTime: 10_000,
    };

    const result = renderFooterAtTime(info, 15_000);

    expect(result).toContain("iter 2/50");
    expect(result).toContain("5s");
    expect(result).toContain("anthropic/claude-sonnet-4");
    expect(result).toContain("high");
  });

  test("renders thinking off", () => {
    const info: StatusBarInfo = {
      iteration: 1,
      maxIter: 10,
      model: "openai/gpt-4o",
      thinking: "off",
      startTime: Date.now(),
    };

    const result = renderFooterAtTime(info, info.startTime);

    expect(result).toContain("iter 1/10");
    expect(result).toContain("off");
    expect(result).toContain("openai/gpt-4o");
  });

  test("fields are separated by centered dots", () => {
    const info: StatusBarInfo = {
      iteration: 3,
      maxIter: 20,
      model: "test/model",
      thinking: "low",
      startTime: Date.now(),
    };

    const result = renderFooterAtTime(info, info.startTime);
    // \u00b7 is the centered dot separator
    expect(result).toContain("\u00b7");
  });

  test("starts with spaces for padding", () => {
    const info: StatusBarInfo = {
      iteration: 1,
      maxIter: 5,
      model: "m",
      thinking: "off",
      startTime: Date.now(),
    };

    const result = renderFooterAtTime(info, info.startTime);
    expect(result.startsWith(" ")).toBe(true);
  });

  test("renderFooter uses current wall-clock time", () => {
    const now = Date.now();
    const info: StatusBarInfo = {
      iteration: 1,
      maxIter: 1,
      model: "m",
      thinking: "off",
      startTime: now - 2_000,
    };

    const result = renderFooter(info);
    expect(result).toContain("iter 1/1");
    expect(result).toContain("off");
    expect(result).toContain("m");
  });

  test("supports deterministic rendering with injected timestamp", () => {
    const info: StatusBarInfo = {
      iteration: 4,
      maxIter: 12,
      model: "provider/model",
      thinking: "medium",
      startTime: 1_000,
    };

    const result = renderFooterAtTime(info, 63_000);
    expect(result).toContain("iter 4/12");
    expect(result).toContain("1m 02s");
    expect(result).toContain("provider/model");
    expect(result).toContain("medium");
  });

  test("left and right parts are separated by whitespace gap", () => {
    const info: StatusBarInfo = {
      iteration: 1,
      maxIter: 5,
      model: "test/model",
      thinking: "high",
      startTime: 0,
    };

    const result = renderFooterAtTime(info, 0);
    // There should be multiple spaces between left group and right group
    expect(result).toMatch(/\d+s\s{4,}test\/model/);
  });
});
