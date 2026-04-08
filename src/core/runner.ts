// ─── Session Runner ───────────────────────────────────────────────────────────
// Runs the opencode agent loop, detects done token, logs output.

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
}

type RunOpencodeFn = (
  bin: string,
  agentName: string,
  model: string,
  prompt: string,
  logPath: string,
  write: (text: string) => void
) => Promise<string>;

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
  }) => StatusBarLike;
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

  const agent = deps.setupAgent(variantConfig ?? null);
  const opencodeBin = await deps.findOpencodeBin();

  // The status bar shows total iteration numbers so the user knows
  // where they are overall (e.g. iter 51/70 when resuming from 50 with 20 more).
  const totalMax = iterOffset + maxIter;
  let bar: StatusBarLike | null = null;
  if (useStatusBar) {
    bar = deps.createStatusBar({ model, thinking, maxIter: totalMax });
    bar.start();
  }

  let iterations = iterOffset;
  let status: "complete" | "incomplete" = "incomplete";

  // Writer function — routes output through the status bar if active
  const writeOutput = bar
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

      // When resuming, every iteration is a continuation (the original
      // prompt was already sent in the first run). For new sessions,
      // only iteration 1 sends the raw prompt.
      const iterPrompt =
        !isResume && i === 1
          ? prompt
          : `Continue working on the following task. Check the current state of the codebase and pick up where you left off: ${prompt}`;

      const output = await deps.runOpencode(
        opencodeBin,
        agent.agentName,
        model,
        iterPrompt,
        logPath,
        writeOutput
      );

      if (output.includes(DONE_TOKEN)) {
        status = "complete";
        bar?.stop();
        bar = null;
        opts.onComplete?.(totalIter);
        break;
      }
    }

    if (status !== "complete") {
      bar?.stop();
      bar = null;
      opts.onMaxReached?.(totalMax);
    }
  } finally {
    bar?.stop();
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
 * Run a single opencode invocation. Streams output through the provided
 * writer function and appends to a log file. Throws if the subprocess
 * exits with a non-zero code.
 */
async function runOpencode(
  bin: string,
  agentName: string,
  model: string,
  prompt: string,
  logPath: string,
  write: (text: string) => void
): Promise<string> {
  const proc = Bun.spawn(
    [bin, "run", "--agent", agentName, "--model", model, prompt],
    {
      stdout: "pipe",
      stderr: "inherit",
    }
  );

  let output = "";
  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();

  // Open the log file for appending
  const logFd = Bun.file(logPath).writer();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    output += text;
    write(text);
    logFd.write(text);
  }

  logFd.end();

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`opencode exited with code ${exitCode}`);
  }

  return output;
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
