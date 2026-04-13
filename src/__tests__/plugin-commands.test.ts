import { describe, expect, it } from "bun:test";
import { formatRunStatus, parseIterationLimit } from "../plugin/commands.js";
import {
  createRunState,
  createSessionState,
} from "../plugin/runtime.js";

describe("plugin commands", () => {
  it("parses positive iteration limits", () => {
    expect(parseIterationLimit("20")).toBe(20);
    expect(parseIterationLimit(" 7 ")).toBe(7);
    expect(parseIterationLimit("0")).toBeNull();
    expect(parseIterationLimit("abc")).toBeNull();
    expect(parseIterationLimit("")).toBeNull();
  });

  it("formats idle and active statuses", () => {
    const idle = createSessionState("session-1", 50);
    expect(formatRunStatus(idle)).toBe("Ralph idle. Default limit 50.");

    const active = createSessionState("session-2", 50);
    active.run = createRunState("message-1", 20);
    active.run.status = "paused";
    active.run.waitReason = "Need API key";

    expect(formatRunStatus(active)).toBe(
      "Ralph paused 1/20 (Need API key)"
    );
  });
});
