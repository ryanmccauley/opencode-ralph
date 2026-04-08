// ─── Sessions Browser ─────────────────────────────────────────────────────────
// Browse recent sessions, view logs, re-run.

import * as p from "@clack/prompts";
import { readFileSync } from "fs";
import { listSessions, formatSessionLine, getLogPath } from "../core/sessions.js";
import { runSession } from "../core/runner.js";
import type { ModelInfo } from "../types.js";
import { dim } from "./theme.js";

export async function sessionsFlow(models: ModelInfo[]): Promise<void> {
  const sessions = await listSessions();

  if (sessions.length === 0) {
    p.log.message(dim("No sessions yet. Start a new session to get going."));
    return;
  }

  const options = sessions.map((s) => ({
    value: s.timestamp,
    label: formatSessionLine(s),
  }));

  const selected = await p.select({
    message: "SESSIONS",
    options,
  });

  if (p.isCancel(selected)) return;
  const sessionId = selected as string;

  const meta = sessions.find((s) => s.timestamp === sessionId);
  if (!meta) {
    p.log.error("Session not found.");
    return;
  }

  // Show session details
  const pad = (label: string) => label.padEnd(14);
  const detail = [
    `${pad("Timestamp")} ${meta.timestamp}`,
    `${pad("Model")} ${meta.model}`,
    `${pad("Thinking")} ${meta.thinking}`,
    `${pad("Max iter")} ${meta.maxIter}`,
    `${pad("Status")} ${meta.status}`,
    `${pad("Iterations")} ${meta.iterations}`,
    ``,
    `${pad("Prompt")}`,
    `${meta.prompt}`,
  ].join("\n");

  p.box(detail, "Session Details");

  // Actions
  const action = await p.select({
    message: "Action",
    options: [
      { value: "log", label: "View log" },
      { value: "rerun", label: "Re-run (same settings)" },
      { value: "back", label: "Back" },
    ],
  });

  if (p.isCancel(action) || action === "back") return;

  if (action === "log") {
    const logPath = getLogPath(sessionId);
    try {
      const log = readFileSync(logPath, "utf-8");
      console.log(log);
    } catch {
      p.log.message(dim("No log file for this session."));
    }
    await p.text({ message: "Press Enter to continue...", defaultValue: "" });
    return;
  }

  if (action === "rerun") {
    const modelInfo = models.find((m) => m.id === meta.model);
    const variantConfig =
      meta.thinking !== "off" && modelInfo
        ? modelInfo.variants[meta.thinking] ?? null
        : null;

    await runSession({
      model: meta.model,
      thinking: meta.thinking,
      maxIter: meta.maxIter,
      prompt: meta.prompt,
      variantConfig,
      onIteration(current, max) {
        console.log(`\n[${current}/${max}]\n`);
      },
      onComplete(iterations) {
        console.log(`\n[complete: ${iterations} iterations]`);
      },
      onMaxReached(max) {
        console.log(`\n[max iterations reached: ${max}]`);
      },
    });

    await p.text({ message: "Press Enter to continue...", defaultValue: "" });
  }
}
