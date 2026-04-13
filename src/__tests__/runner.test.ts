import { describe, test, expect } from "bun:test";
import { mkdirSync } from "fs";
import {
  runSessionWithDeps,
  type RunOptions,
  type RunnerDeps,
  type StatusBarLike,
  type RunResult,
} from "../core/runner.js";
import type { SessionMeta } from "../types.js";
import { DONE_TOKEN } from "../types.js";
import type { FeedbackQueueLike, InputHandlerLike } from "../tui/feedback.js";

interface Harness {
  deps: Partial<RunnerDeps>;
  calls: {
    prompts: string[];
    mkdirPaths: string[];
    stdoutWrites: string[];
    logs: string[];
    savedMeta: SessionMeta[];
    cleanupCount: number;
    statusBarCreateCount: number;
    statusBarStartCount: number;
    statusBarStopCount: number;
    statusBarIterations: number[];
    statusBarWrites: string[];
    inputHandlerStartCount: number;
    inputHandlerStopCount: number;
    inputHandlerAbortControllers: AbortController[];
  };
  feedbackQueue: FeedbackQueueLike;
  inputHandler: InputHandlerLike;
}

function createHarness(overrides: Partial<RunnerDeps> = {}): Harness {
  const calls: Harness["calls"] = {
    prompts: [],
    mkdirPaths: [],
    stdoutWrites: [],
    logs: [],
    savedMeta: [],
    cleanupCount: 0,
    statusBarCreateCount: 0,
    statusBarStartCount: 0,
    statusBarStopCount: 0,
    statusBarIterations: [],
    statusBarWrites: [],
    inputHandlerStartCount: 0,
    inputHandlerStopCount: 0,
    inputHandlerAbortControllers: [],
  };

  const bar: StatusBarLike = {
    start() {
      calls.statusBarStartCount++;
    },
    stop() {
      calls.statusBarStopCount++;
    },
    setIteration(current: number) {
      calls.statusBarIterations.push(current);
    },
    write(text: string) {
      calls.statusBarWrites.push(text);
    },
    setInputBuffer() {
      // no-op for tests
    },
  };

  const feedbackQueue: FeedbackQueueLike = {
    _messages: [] as string[],
    push(msg: string) {
      const trimmed = msg.trim();
      if (trimmed) (this as any)._messages.push(trimmed);
    },
    drain(): string | null {
      const msgs = (this as any)._messages as string[];
      if (msgs.length === 0) return null;
      const result = msgs.join("\n");
      msgs.length = 0;
      return result;
    },
    hasPending(): boolean {
      return ((this as any)._messages as string[]).length > 0;
    },
  } as FeedbackQueueLike;

  const inputHandler: InputHandlerLike = {
    start() {
      calls.inputHandlerStartCount++;
    },
    stop() {
      calls.inputHandlerStopCount++;
    },
    setAbortController(ac: AbortController) {
      calls.inputHandlerAbortControllers.push(ac);
    },
  };

  const base: Partial<RunnerDeps> = {
    setupAgent() {
      return { agentName: "test-agent", tmpFile: null };
    },
    cleanupAgent() {
      calls.cleanupCount++;
    },
    findOpencodeBin: async () => "/fake/opencode",
    generateSessionId: () => "generated-session",
    saveSessionMeta: async (meta) => {
      calls.savedMeta.push(meta);
    },
    getLogPath: (sessionId) => `/tmp/${sessionId}.log`,
    getSessionsDir: () => "/tmp/sessions",
    canShowStatusBar: () => true,
    createStatusBar() {
      calls.statusBarCreateCount++;
      return bar;
    },
    createFeedbackQueue() {
      return feedbackQueue;
    },
    createInputHandler() {
      return inputHandler;
    },
    runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
      calls.prompts.push(prompt);
      write(`[chunk:${calls.prompts.length}]`);
      return { output: "", aborted: false };
    },
    mkdirSync: ((path: string) => {
      calls.mkdirPaths.push(path);
    }) as typeof mkdirSync,
    writeStdout: (text) => {
      calls.stdoutWrites.push(text);
    },
    log: (text) => {
      calls.logs.push(text);
    },
  };

  return {
    deps: { ...base, ...overrides },
    calls,
    feedbackQueue,
    inputHandler,
  };
}

function makeOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    model: "openai/gpt-4o",
    thinking: "off",
    maxIter: 3,
    prompt: "Fix all failing tests",
    showStatusBar: false,
    ...overrides,
  };
}

describe("runSessionWithDeps", () => {
  test("uses raw prompt first, continuation prompt after, and marks complete", async () => {
    let call = 0;
    const { deps, calls } = createHarness({
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        call++;
        calls.prompts.push(prompt);
        write(`[chunk:${call}]`);
        return { output: call === 2 ? `done ${DONE_TOKEN}` : "working", aborted: false };
      },
    });

    const completed: number[] = [];
    const maxed: number[] = [];

    await runSessionWithDeps(
      makeOptions({
        maxIter: 5,
        onComplete: (n) => completed.push(n),
        onMaxReached: (n) => maxed.push(n),
      }),
      deps
    );

    expect(calls.prompts).toHaveLength(2);
    expect(calls.prompts[0]).toBe("Fix all failing tests");
    expect(calls.prompts[1]).toBe(
      "Continue working on the following task. Check the current state of the codebase and pick up where you left off: Fix all failing tests"
    );

    expect(completed).toEqual([2]);
    expect(maxed).toEqual([]);

    expect(calls.savedMeta).toHaveLength(1);
    expect(calls.savedMeta[0]).toMatchObject({
      timestamp: "generated-session",
      status: "complete",
      iterations: 2,
      maxIter: 5,
      prompt: "Fix all failing tests",
      model: "openai/gpt-4o",
      thinking: "off",
    });
    expect(calls.cleanupCount).toBe(1);
  });

  test("marks session incomplete when max iterations are reached", async () => {
    const completed: number[] = [];
    const maxed: number[] = [];

    const { deps, calls } = createHarness();

    await runSessionWithDeps(
      makeOptions({
        maxIter: 3,
        onComplete: (n) => completed.push(n),
        onMaxReached: (n) => maxed.push(n),
      }),
      deps
    );

    expect(calls.prompts).toHaveLength(3);
    expect(calls.prompts[0]).toBe("Fix all failing tests");
    expect(calls.prompts[1]).toContain("Continue working on the following task.");
    expect(calls.prompts[2]).toContain("Continue working on the following task.");

    expect(completed).toEqual([]);
    expect(maxed).toEqual([3]);

    expect(calls.savedMeta[0]).toMatchObject({
      status: "incomplete",
      iterations: 3,
      maxIter: 3,
    });
    expect(calls.cleanupCount).toBe(1);
  });

  test("resume mode always uses continuation prompt and keeps session id", async () => {
    const completed: number[] = [];

    const { deps, calls } = createHarness({
      generateSessionId: () => {
        throw new Error("generateSessionId must not run in resume mode");
      },
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        calls.prompts.push(prompt);
        write("[resume-chunk]");
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(
      makeOptions({
        maxIter: 20,
        resumeSessionId: "session-123",
        resumeFromIteration: 50,
        onComplete: (n) => completed.push(n),
      }),
      deps
    );

    expect(calls.prompts).toHaveLength(1);
    expect(calls.prompts[0]).toBe(
      "Continue working on the following task. Check the current state of the codebase and pick up where you left off: Fix all failing tests"
    );
    expect(completed).toEqual([51]);

    expect(calls.savedMeta[0]).toMatchObject({
      timestamp: "session-123",
      status: "complete",
      iterations: 51,
      maxIter: 70,
    });
  });

  test("writes through stdout when status bar is disabled", async () => {
    const { deps, calls } = createHarness({
      canShowStatusBar: () => false,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        calls.prompts.push(prompt);
        write("plain-output");
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(makeOptions({ showStatusBar: true, useRenderer: false }), deps);

    expect(calls.statusBarCreateCount).toBe(0);
    expect(calls.stdoutWrites).toEqual(["plain-output"]);
    expect(calls.statusBarWrites).toEqual([]);
  });

  test("uses status bar writer when enabled", async () => {
    const { deps, calls } = createHarness({
      canShowStatusBar: () => true,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        calls.prompts.push(prompt);
        write("bar-output");
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(makeOptions({ showStatusBar: true, useRenderer: false }), deps);

    expect(calls.statusBarCreateCount).toBe(1);
    expect(calls.statusBarStartCount).toBe(1);
    expect(calls.statusBarStopCount).toBe(1);
    expect(calls.statusBarIterations).toEqual([1]);
    expect(calls.statusBarWrites).toEqual(["bar-output"]);
    expect(calls.stdoutWrites).toEqual([]);
  });

  test("always cleans up agent when runOpencode throws", async () => {
    const { deps, calls } = createHarness({
      runOpencode: async () => {
        throw new Error("opencode exploded");
      },
    });

    await expect(runSessionWithDeps(makeOptions(), deps)).rejects.toThrow(
      "opencode exploded"
    );

    expect(calls.cleanupCount).toBe(1);
    expect(calls.savedMeta).toEqual([]);
  });

  // ─── Feedback / abort tests ────────────────────────────────────────────

  test("starts and stops input handler when feedback is enabled with status bar", async () => {
    const { deps, calls } = createHarness({
      canShowStatusBar: () => true,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        calls.prompts.push(prompt);
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(
      makeOptions({ showStatusBar: true, enableFeedback: true }),
      deps
    );

    expect(calls.inputHandlerStartCount).toBe(1);
    expect(calls.inputHandlerStopCount).toBeGreaterThanOrEqual(1);
  });

  test("does not start input handler when feedback is disabled", async () => {
    const { deps, calls } = createHarness({
      canShowStatusBar: () => true,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        calls.prompts.push(prompt);
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(
      makeOptions({ showStatusBar: true, enableFeedback: false }),
      deps
    );

    expect(calls.inputHandlerStartCount).toBe(0);
    expect(calls.inputHandlerStopCount).toBe(0);
  });

  test("does not start input handler when status bar is disabled", async () => {
    const { deps, calls } = createHarness({
      canShowStatusBar: () => false,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        calls.prompts.push(prompt);
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(
      makeOptions({ showStatusBar: true, enableFeedback: true }),
      deps
    );

    expect(calls.inputHandlerStartCount).toBe(0);
  });

  test("sets abort controller on input handler each iteration", async () => {
    let call = 0;
    const { deps, calls } = createHarness({
      canShowStatusBar: () => true,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        call++;
        calls.prompts.push(prompt);
        return { output: call === 3 ? DONE_TOKEN : "", aborted: false };
      },
    });

    await runSessionWithDeps(
      makeOptions({ showStatusBar: true, enableFeedback: true, maxIter: 5 }),
      deps
    );

    // Should have set an AbortController for each of the 3 iterations
    expect(calls.inputHandlerAbortControllers).toHaveLength(3);
    // Each should be a distinct AbortController
    const unique = new Set(calls.inputHandlerAbortControllers);
    expect(unique.size).toBe(3);
  });

  test("aborted iteration continues to next with feedback in prompt", async () => {
    let call = 0;
    const { deps, calls, feedbackQueue } = createHarness({
      canShowStatusBar: () => true,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        call++;
        calls.prompts.push(prompt);

        if (call === 1) {
          // Simulate user submitting feedback during iteration 1
          feedbackQueue.push("try a different approach");
          return { output: "partial", aborted: true };
        }
        // Iteration 2: should include the feedback
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(
      makeOptions({ showStatusBar: true, enableFeedback: true, maxIter: 5 }),
      deps
    );

    expect(calls.prompts).toHaveLength(2);
    // First prompt is the raw prompt
    expect(calls.prompts[0]).toBe("Fix all failing tests");
    // Second prompt should include the feedback
    expect(calls.prompts[1]).toContain("User feedback during session:");
    expect(calls.prompts[1]).toContain("try a different approach");
    expect(calls.prompts[1]).toContain("Continue working on the following task.");
  });

  test("multiple feedback messages are concatenated", async () => {
    let call = 0;
    const { deps, calls, feedbackQueue } = createHarness({
      canShowStatusBar: () => true,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        call++;
        calls.prompts.push(prompt);

        if (call === 1) {
          feedbackQueue.push("first feedback");
          feedbackQueue.push("second feedback");
          return { output: "", aborted: true };
        }
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(
      makeOptions({ showStatusBar: true, enableFeedback: true, maxIter: 5 }),
      deps
    );

    expect(calls.prompts[1]).toContain("first feedback\nsecond feedback");
  });

  test("aborted iteration still counts toward total iterations", async () => {
    let call = 0;
    const { deps, calls, feedbackQueue } = createHarness({
      canShowStatusBar: () => true,
      runOpencode: async (_bin, _agentName, _model, prompt, _logPath, write) => {
        call++;
        calls.prompts.push(prompt);

        if (call === 1) {
          feedbackQueue.push("feedback");
          return { output: "", aborted: true };
        }
        if (call === 2) {
          return { output: "", aborted: false };
        }
        return { output: DONE_TOKEN, aborted: false };
      },
    });

    await runSessionWithDeps(
      makeOptions({ showStatusBar: true, enableFeedback: true, maxIter: 5 }),
      deps
    );

    expect(calls.savedMeta[0]).toMatchObject({
      status: "complete",
      iterations: 3,
    });
  });

  test("stops input handler on cleanup even after error", async () => {
    const { deps, calls } = createHarness({
      canShowStatusBar: () => true,
      runOpencode: async () => {
        throw new Error("kaboom");
      },
    });

    await expect(
      runSessionWithDeps(
        makeOptions({ showStatusBar: true, enableFeedback: true }),
        deps
      )
    ).rejects.toThrow("kaboom");

    expect(calls.inputHandlerStopCount).toBeGreaterThanOrEqual(1);
    expect(calls.cleanupCount).toBe(1);
  });
});
