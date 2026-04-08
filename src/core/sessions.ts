// ─── Session Meta Storage ─────────────────────────────────────────────────────
// Read/write session metadata to ~/.ralph/sessions/*.meta

import { mkdirSync, readdirSync } from "fs";
import type { SessionMeta } from "../types.js";
import { SESSIONS_DIR } from "./config.js";

export function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return [
    now.getFullYear(),
    "-",
    pad(now.getMonth() + 1),
    "-",
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

export async function saveSessionMeta(meta: SessionMeta): Promise<void> {
  mkdirSync(SESSIONS_DIR, { recursive: true });

  const safePrompt = meta.prompt.replace(/\n/g, " ");
  const content = [
    `timestamp=${meta.timestamp}`,
    `model=${meta.model}`,
    `thinking=${meta.thinking}`,
    `max_iter=${meta.maxIter}`,
    `prompt=${safePrompt}`,
    `status=${meta.status}`,
    `iterations=${meta.iterations}`,
    "",
  ].join("\n");

  await Bun.write(`${SESSIONS_DIR}/${meta.timestamp}.meta`, content);
}

export async function listSessions(): Promise<SessionMeta[]> {
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    const files = readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".meta"))
      .sort()
      .reverse();

    const sessions: SessionMeta[] = [];
    for (const file of files) {
      const meta = await readSessionMeta(`${SESSIONS_DIR}/${file}`);
      if (meta) sessions.push(meta);
    }
    return sessions;
  } catch {
    return [];
  }
}

async function readSessionMeta(path: string): Promise<SessionMeta | null> {
  try {
    const text = await Bun.file(path).text();
    const fields: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }

    return {
      timestamp: fields.timestamp ?? "",
      model: fields.model ?? "",
      thinking: fields.thinking ?? "off",
      maxIter: parseInt(fields.max_iter ?? "50", 10),
      prompt: fields.prompt ?? "",
      status: fields.status === "complete" ? "complete" : "incomplete",
      iterations: parseInt(fields.iterations ?? "0", 10),
    };
  } catch {
    return null;
  }
}

export function getLogPath(sessionId: string): string {
  return `${SESSIONS_DIR}/${sessionId}.log`;
}

export function formatSessionLine(meta: SessionMeta): string {
  const icon = meta.status === "complete" ? "\u00B7" : "\u25CB";
  const short =
    meta.prompt.length > 40 ? meta.prompt.slice(0, 40) + "..." : meta.prompt;
  return `${icon} ${meta.timestamp}  ${meta.model}  ${short}`;
}
