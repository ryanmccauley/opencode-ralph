// ─── Session Runner ───────────────────────────────────────────────────────────
// Runs the opencode agent loop, detects done token, logs output.

import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { setupAgent, cleanupAgent } from "./agent.js";
import {
  generateSessionId,
  saveSessionMeta,
  getLogPath,
} from "./sessions.js";
import { SESSIONS_DIR } from "./config.js";
import type { ModelInfo } from "../types.js";
import { DONE_TOKEN } from "../types.js";

/**
 * Find the opencode binary. Checks common locations.
 */
export async function findOpencodeBin(): Promise<string> {
  // Check PATH first
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    const candidate = join(dir, "opencode");
    if (existsSync(candidate)) return candidate;
  }

  // Check well-known locations
  const candidates = [
    join(homedir(), ".opencode", "bin", "opencode"),
    join(homedir(), ".local", "bin", "opencode"),
    join(homedir(), "go", "bin", "opencode"),
    "/usr/local/bin/opencode",
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  throw new Error(
    "Could not find opencode binary. Install it or add it to your PATH."
  );
}

export interface RunOptions {
  model: string;
  /** Thinking variant name for display/logging, or "off" */
  thinking: string;
  maxIter: number;
  prompt: string;
  /** Raw variant config object to pass into the agent YAML, or null for no thinking */
  variantConfig?: Record<string, unknown> | null;
  /** Called before each iteration */
  onIteration?: (current: number, max: number) => void;
  /** Called when session completes */
  onComplete?: (iterations: number) => void;
  /** Called when max iterations reached */
  onMaxReached?: (max: number) => void;
}

/**
 * Run an agent session. Works in both TUI and CLI mode.
 */
export async function runSession(opts: RunOptions): Promise<void> {
  const { model, thinking, maxIter, prompt, variantConfig } = opts;

  const sessionId = generateSessionId();
  const logPath = getLogPath(sessionId);
  mkdirSync(SESSIONS_DIR, { recursive: true });

  const agent = setupAgent(variantConfig ?? null);
  const opencodeBin = await findOpencodeBin();

  let iterations = 0;
  let status: "complete" | "incomplete" = "incomplete";

  try {
    for (let i = 1; i <= maxIter; i++) {
      iterations = i;
      opts.onIteration?.(i, maxIter);

      const iterPrompt =
        i === 1
          ? prompt
          : `Continue working on the following task. Check the current state of the codebase and pick up where you left off: ${prompt}`;

      const output = await runOpencode(
        opencodeBin,
        agent.agentName,
        model,
        iterPrompt,
        logPath
      );

      if (output.includes(DONE_TOKEN)) {
        status = "complete";
        opts.onComplete?.(i);
        break;
      }
    }

    if (status !== "complete") {
      opts.onMaxReached?.(maxIter);
    }
  } finally {
    cleanupAgent(agent);
  }

  await saveSessionMeta({
    timestamp: sessionId,
    model,
    thinking,
    maxIter,
    prompt,
    status,
    iterations,
  });

  console.log(`\n  session saved: ${sessionId}`);
}

/**
 * Run a single opencode invocation. Streams output to stdout and log file.
 */
async function runOpencode(
  bin: string,
  agentName: string,
  model: string,
  prompt: string,
  logPath: string
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
  const logFile = Bun.file(logPath);

  // Stream output to both stdout and log
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    output += text;
    chunks.push(text);
    process.stdout.write(text);
  }

  // Append to log file
  const existingLog = (await logFile.exists()) ? await logFile.text() : "";
  await Bun.write(logPath, existingLog + chunks.join(""));

  await proc.exited;
  return output;
}

/**
 * Run a single one-shot opencode invocation (--once mode).
 */
export async function runOnce(
  model: string,
  thinking: string,
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
    await proc.exited;
  } finally {
    cleanupAgent(agent);
  }
}
