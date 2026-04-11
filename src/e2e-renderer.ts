#!/usr/bin/env bun
// ─── End-to-end renderer test ─────────────────────────────────────────────────
// Runs a real `opencode run --format json` invocation and pipes the output
// through our TreeRenderer to verify the shard-tree layout works end-to-end.
//
// Usage: bun run src/e2e-renderer.ts

import { TreeRenderer } from "./tui/renderer.js";
import { findOpencodeBin } from "./core/opencode.js";

const MODEL = "github-copilot/claude-haiku-4.5";
const PROMPT = "Read the file src/tui/renderer.ts and tell me what it does. Keep your answer to one sentence.";
const AGENT = "build";

async function main() {
  const bin = await findOpencodeBin();
  console.log(`Using opencode binary: ${bin}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Prompt: ${PROMPT}`);
  console.log("─".repeat(60));
  console.log("");

  const renderer = new TreeRenderer({ writer: process.stdout });
  renderer.onEvent({ type: "session_start", prompt: PROMPT });

  const proc = Bun.spawn(
    [bin, "run", "--format", "json", "--agent", AGENT, "--model", MODEL, PROMPT],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();

  // Also capture stderr for debugging
  const stderrReader = proc.stderr.getReader();
  const stderrChunks: string[] = [];
  (async () => {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderrChunks.push(decoder.decode(value));
    }
  })();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    renderer.feedChunk(chunk);
  }

  renderer.flush();

  const exitCode = await proc.exited;

  console.log("");
  console.log("─".repeat(60));
  console.log(`Exit code: ${exitCode}`);

  if (stderrChunks.length > 0) {
    console.log("Stderr:");
    console.log(stderrChunks.join(""));
  }

  renderer.cleanup();
}

main().catch((err) => {
  console.error("E2E test failed:", err.message ?? err);
  process.exit(1);
});
