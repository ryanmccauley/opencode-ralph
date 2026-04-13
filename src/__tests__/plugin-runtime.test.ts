import { describe, expect, it } from "bun:test";
import {
  createRunState,
  shouldAutoContinue,
  shouldEvaluateIdle,
} from "../plugin/runtime.js";

describe("plugin runtime", () => {
  it("evaluates idle only for a new assistant message", () => {
    const run = createRunState("message-1", 3);
    expect(shouldEvaluateIdle(run)).toBe(false);

    run.lastAssistantMessageID = "assistant-1";
    expect(shouldEvaluateIdle(run)).toBe(true);

    run.lastEvaluatedAssistantMessageID = "assistant-1";
    expect(shouldEvaluateIdle(run)).toBe(false);
  });

  it("continues until completion or the iteration limit", () => {
    const run = createRunState("message-1", 2);
    expect(shouldAutoContinue(run)).toBe(true);

    run.iteration = 2;
    expect(shouldAutoContinue(run)).toBe(false);

    run.iteration = 1;
    run.sawCompletion = true;
    expect(shouldAutoContinue(run)).toBe(false);
  });
});
