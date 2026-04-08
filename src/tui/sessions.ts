// ─── Sessions Browser ─────────────────────────────────────────────────────────
// Browse recent sessions, view logs, re-run, or resume.

import * as p from "@clack/prompts";
import { listSessions, formatSessionLine, getLogPath } from "../core/sessions.js";
import { runSession } from "../core/runner.js";
import type { ModelInfo } from "../types.js";
import { dim } from "./theme.js";
import { createRunCallbacks, validatePositiveInt } from "./helpers.js";

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

  // Build action list — "Resume" only shown for incomplete sessions
  const actionOptions: { value: string; label: string }[] = [
    { value: "log", label: "View log" },
  ];

  if (meta.status === "incomplete") {
    actionOptions.push({
      value: "resume",
      label: "Resume (continue from where it stopped)",
    });
  }

  actionOptions.push(
    { value: "rerun", label: "Re-run (fresh session, same settings)" },
    { value: "back", label: "Back" }
  );

  const action = await p.select({
    message: "Action",
    options: actionOptions,
  });

  if (p.isCancel(action) || action === "back") return;

  if (action === "log") {
    const logPath = getLogPath(sessionId);
    try {
      const log = await Bun.file(logPath).text();
      console.log(log);
    } catch {
      p.log.message(dim("No log file for this session."));
    }
    await p.text({ message: "Press Enter to continue...", defaultValue: "" });
    return;
  }

  if (action === "resume") {
    // Ask how many additional iterations to allow
    const iterResult = await p.text({
      message: "ADDITIONAL ITERATIONS",
      placeholder: "20",
      defaultValue: String(meta.maxIter),
      validate: validatePositiveInt,
    });

    if (p.isCancel(iterResult)) return;
    const additionalIter = parseInt(iterResult as string, 10);

    const modelInfo = models.find((m) => m.id === meta.model);
    const variantConfig =
      meta.thinking !== "off" && modelInfo
        ? modelInfo.variants[meta.thinking] ?? null
        : null;

    p.log.message(
      dim(`Resuming session ${meta.timestamp} from iteration ${meta.iterations}...`)
    );

    await runSession({
      model: meta.model,
      thinking: meta.thinking,
      maxIter: additionalIter,
      prompt: meta.prompt,
      variantConfig,
      resumeSessionId: meta.timestamp,
      resumeFromIteration: meta.iterations,
      ...createRunCallbacks(),
    });

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
      ...createRunCallbacks(),
    });

    await p.text({ message: "Press Enter to continue...", defaultValue: "" });
  }
}
