// ─── Session Runner ───────────────────────────────────────────────────────────
// Runs the opencode agent loop, detects done token, logs output.
// Uses `opencode run --format json` for structured event output and feeds
// events through the tree renderer for formatted display.
//
// Supports mid-session user feedback: when enabled, the user can type feedback
// in a prompt at the bottom of the terminal. Submitting feedback aborts the
// current iteration and injects the feedback into the next iteration's prompt.

import { mkdirSync } from "fs";
import { setupAgent, cleanupAgent } from "./agent.js";
import { findOpencodeBin } from "./opencode.js";
import {
  generateSessionId,
  saveSessionMeta,
  getLogPath,
} from "./sessions.js";
import { getSessionsDir } from "./config.js";
import { DONE_TOKEN } from "../types.js";
import { StatusBar, canShowStatusBar } from "../tui/status-bar.js";
import { TreeRenderer, type RendererWriter } from "../tui/renderer.js";
import {
  FeedbackQueue,
  RawInputHandler,
  type FeedbackQueueLike,
  type InputHandlerLike,
  type InputStatusBar,
} from "../tui/feedback.js";

// ─── Result type for runOpencode ─────────────────────────────────────────────

export interface RunResult {
  output: string;
  aborted: boolean;
}

// ─── Options & interfaces ────────────────────────────────────────────────────

export interface RunOptions {
  model: string;
  /** Thinking variant name for display/logging, or "off" */
  thinking: string;
  maxIter: number;
  prompt: string;
  /** Raw variant config object to pass into the agent YAML, or null for no thinking */
  variantConfig?: Record<string, unknown> | null;
  /** Whether to show the floating status bar (default: true). */
  showStatusBar?: boolean;
  /** Whether to use the tree renderer for structured output (default: true). */
  useRenderer?: boolean;
  /** Whether to enable mid-session feedback input (default: true).
   *  Only effective when the status bar is also enabled and stdin is a TTY. */
  enableFeedback?: boolean;

  // ─── Resume fields ──────────────────────────────────────────────────────
  /** Existing session ID to resume. When set, reuses the session's log and
   *  metadata instead of creating new ones. */
  resumeSessionId?: string;
  /** The iteration count from the previous run. The loop starts at
   *  `resumeFromIteration + 1` and always uses the continuation prompt. */
  resumeFromIteration?: number;

  /** Called before each iteration */
  onIteration?: (current: number, max: number) => void;
  /** Called when session completes */
  onComplete?: (iterations: number) => void;
  /** Called when max iterations reached */
  onMaxReached?: (max: number) => void;
}

export interface StatusBarLike {
  start(): void;
  stop(): void;
  setIteration(current: number): void;
  write(text: string): void;
  setInputBuffer(text: string): void;
}

export interface RendererLike {
  onEvent(event: import("../tui/events.js").RenderEvent): void;
  feedChunk(chunk: string): void;
  flush(): void;
  cleanup(): void;
}

type RunOpencodeFn = (
  bin: string,
  agentName: string,
  model: string,
  prompt: string,
  logPath: string,
  write: (text: string) => void,
  signal?: AbortSignal
) => Promise<RunResult>;

export interface RunnerDeps {
  setupAgent: typeof setupAgent;
  cleanupAgent: typeof cleanupAgent;
  findOpencodeBin: typeof findOpencodeBin;
  generateSessionId: typeof generateSessionId;
  saveSessionMeta: typeof saveSessionMeta;
  getLogPath: typeof getLogPath;
  getSessionsDir: typeof getSessionsDir;
  canShowStatusBar: () => boolean;
  createStatusBar: (opts: {
    model: string;
    thinking: string;
    maxIter: number;
    enableInput?: boolean;
  }) => StatusBarLike;
  createRenderer: (writer: RendererWriter) => RendererLike;
  createFeedbackQueue: () => FeedbackQueueLike;
  createInputHandler: (
    bar: InputStatusBar,
    queue: FeedbackQueueLike
  ) => InputHandlerLike;
  runOpencode: RunOpencodeFn;
  mkdirSync: typeof mkdirSync;
  writeStdout: (text: string) => void;
  log: (text: string) => void;
}

const DEFAULT_RUNNER_DEPS: RunnerDeps = {
  setupAgent,
  cleanupAgent,
  findOpencodeBin,
  generateSessionId,
  saveSessionMeta,
  getLogPath,
  getSessionsDir,
  canShowStatusBar,
  createStatusBar(opts) {
    return new StatusBar(opts);
  },
  createRenderer(writer: RendererWriter) {
    return new TreeRenderer({ writer });
  },
  createFeedbackQueue() {
    return new FeedbackQueue();
  },
  createInputHandler(bar: InputStatusBar, queue: FeedbackQueueLike) {
    return new RawInputHandler(bar, queue);
  },
  runOpencode,
  mkdirSync,
  writeStdout(text) {
    process.stdout.write(text);
  },
  log(text) {
    console.log(text);
  },
};

/**
 * Run an agent session. Works in both TUI and CLI mode.
 *
 * When `resumeSessionId` is set, the runner continues an existing session:
 * - Reuses the session ID and log file (appending)
 * - Starts the loop counter from `resumeFromIteration + 1`
 * - Always uses the continuation prompt
 * - Updates the existing session metadata when done
 */
export async function runSession(opts: RunOptions): Promise<void> {
  const deps = DEFAULT_RUNNER_DEPS;
  await runSessionWithDeps(opts, deps);
}

/**
 * Internal dependency-injected runner used by tests.
 * Production callers should use runSession().
 */
export async function runSessionWithDeps(
  opts: RunOptions,
  depOverrides: Partial<RunnerDeps>
): Promise<void> {
  const deps: RunnerDeps = { ...DEFAULT_RUNNER_DEPS, ...depOverrides };
  const { model, thinking, maxIter, prompt, variantConfig } = opts;

  const isResume = !!opts.resumeSessionId;
  const iterOffset = isResume ? (opts.resumeFromIteration ?? 0) : 0;
  const sessionId = isResume ? opts.resumeSessionId! : deps.generateSessionId();
  const logPath = deps.getLogPath(sessionId);
  deps.mkdirSync(deps.getSessionsDir(), { recursive: true });

  const useStatusBar = (opts.showStatusBar ?? true) && deps.canShowStatusBar();
  const useRenderer = opts.useRenderer ?? true;
  const useFeedback = (opts.enableFeedback ?? true) && useStatusBar;

  const agent = deps.setupAgent(variantConfig ?? null);
  const opencodeBin = await deps.findOpencodeBin();

  // The status bar shows total iteration numbers so the user knows
  // where they are overall (e.g. iter 51/70 when resuming from 50 with 20 more).
  const totalMax = iterOffset + maxIter;
  let bar: StatusBarLike | null = null;
  if (useStatusBar) {
    bar = deps.createStatusBar({
      model,
      thinking,
      maxIter: totalMax,
      enableInput: useFeedback,
    });
    bar.start();
  }

  // Set up feedback queue and input handler
  let feedbackQueue: FeedbackQueueLike | null = null;
  let inputHandler: InputHandlerLike | null = null;
  if (useFeedback && bar) {
    feedbackQueue = deps.createFeedbackQueue();
    inputHandler = deps.createInputHandler(bar, feedbackQueue);
    inputHandler.start();
  }

  // Set up the tree renderer for structured output
  const rendererWriter: RendererWriter = bar
    ? { write: (text: string) => bar!.write(text) }
    : { write: (text: string) => deps.writeStdout(text) };
  let renderer: RendererLike | null = null;
  if (useRenderer) {
    renderer = deps.createRenderer(rendererWriter);
    // Emit the session header
    renderer.onEvent({ type: "session_start", prompt });
  }

  let iterations = iterOffset;
  let status: "complete" | "incomplete" = "incomplete";

  // Writer function — routes output through renderer or raw passthrough
  const writeOutput = renderer
    ? (text: string) => renderer!.feedChunk(text)
    : bar
      ? (text: string) => bar!.write(text)
      : (text: string) => {
          deps.writeStdout(text);
        };

  try {
    for (let i = 1; i <= maxIter; i++) {
      const totalIter = iterOffset + i;
      iterations = totalIter;

      if (bar) {
        bar.setIteration(totalIter);
      }
      opts.onIteration?.(totalIter, totalMax);

      // Create an AbortController for this iteration.
      // The input handler will signal it when the user submits feedback.
      const abortController = new AbortController();
      if (inputHandler) {
        inputHandler.setAbortController(abortController);
      }

      // Drain any pending feedback (from a previous abort)
      const feedback = feedbackQueue?.drain() ?? null;

      // When resuming, every iteration is a continuation (the original
      // prompt was already sent in the first run). For new sessions,
      // only iteration 1 sends the raw prompt (and only when there's no
      // feedback queued — if the user somehow has feedback already, we
      // use the continuation prompt so the feedback is included).
      const isFirstNewIteration = !isResume && i === 1 && !feedback;
      let iterPrompt: string;

      if (isFirstNewIteration) {
        iterPrompt = prompt;
      } else {
        const feedbackSection = feedback
          ? `\nUser feedback during session:\n${feedback}\n\n`
          : "";
        iterPrompt = `${feedbackSection}Continue working on the following task. Check the current state of the codebase and pick up where you left off: ${prompt}`;
      }

      // Emit feedback event for the renderer so it shows in the tree output
      if (feedback && renderer) {
        renderer.onEvent({ type: "feedback_received", feedback });
      }

      const result = await deps.runOpencode(
        opencodeBin,
        agent.agentName,
        model,
        iterPrompt,
        logPath,
        writeOutput,
        abortController.signal
      );

      if (result.aborted) {
        // User submitted feedback — the iteration was killed.
        // Flush any partial output and continue to the next iteration
        // which will include the queued feedback in its prompt.
        renderer?.flush();
        continue;
      }

      if (result.output.includes(DONE_TOKEN)) {
        status = "complete";
        renderer?.flush();
        renderer?.onEvent({
          type: "session_end",
          iterations: totalIter,
          status: "complete",
        });
        bar?.stop();
        bar = null;
        inputHandler?.stop();
        inputHandler = null;
        opts.onComplete?.(totalIter);
        break;
      }
    }

    if (status !== "complete") {
      renderer?.flush();
      renderer?.onEvent({
        type: "session_end",
        iterations,
        status: "incomplete",
      });
      bar?.stop();
      bar = null;
      inputHandler?.stop();
      inputHandler = null;
      opts.onMaxReached?.(totalMax);
    }
  } finally {
    bar?.stop();
    inputHandler?.stop();
    renderer?.cleanup();
    deps.cleanupAgent(agent);
  }

  // Save (or update) session metadata
  await deps.saveSessionMeta({
    timestamp: sessionId,
    model,
    thinking,
    maxIter: totalMax,
    prompt,
    status,
    iterations,
  });

  deps.log(`\n  session saved: ${sessionId}`);
}

/**
 * Run a single opencode invocation. Streams structured JSON output through
 * the provided writer function and appends raw JSONL to a log file.
 *
 * Supports an optional AbortSignal to allow killing the subprocess
 * mid-execution (used by the feedback system to abort the current iteration).
 *
 * Returns { output, aborted } where `aborted` is true if the signal fired.
 * Throws if the subprocess exits with a non-zero code (unless aborted).
 */
async function runOpencode(
  bin: string,
  agentName: string,
  model: string,
  prompt: string,
  logPath: string,
  write: (text: string) => void,
  signal?: AbortSignal
): Promise<RunResult> {
  const proc = Bun.spawn(
    [bin, "run", "--format", "json", "--agent", agentName, "--model", model, prompt],
    {
      stdout: "pipe",
      stderr: "inherit",
    }
  );

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    proc.kill();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  let output = "";
  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();

  // Open the log file for appending
  const logFd = Bun.file(logPath).writer();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      output += text;
      write(text);
      logFd.write(text);
    }
  } catch (err) {
    // Read errors after abort are expected (stream closed)
    if (!aborted) throw err;
  }

  signal?.removeEventListener("abort", onAbort);
  logFd.end();

  const exitCode = await proc.exited;
  if (exitCode !== 0 && !aborted) {
    throw new Error(`opencode exited with code ${exitCode}`);
  }

  return { output, aborted };
}

/**
 * Run a single one-shot opencode invocation (--once mode).
 */
export async function runOnce(
  model: string,
  prompt: string,
  variantConfig?: Record<string, unknown> | null
): Promise<void> {
  const agent = setupAgent(variantConfig ?? null);
  const opencodeBin = await findOpencodeBin();

  try {
    const proc = Bun.spawn(
      [opencodeBin, "run", "--agent", agent.agentName, "--model", model, prompt],
      {
        stdout: "inherit",
        stderr: "inherit",
      }
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`opencode exited with code ${exitCode}`);
    }
  } finally {
    cleanupAgent(agent);
  }
}
