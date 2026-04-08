// ─── Session Meta Storage ─────────────────────────────────────────────────────
// Read/write session metadata to ~/.ralph/sessions/*.json

import { mkdirSync, readdirSync } from "fs";
import type { SessionMeta } from "../types.js";
import { getSessionsDir } from "./config.js";

export interface SessionsStoreOptions {
  /** Optional override for tests or custom storage locations. */
  sessionsDir?: string;
}

function resolveSessionsDir(opts?: SessionsStoreOptions): string {
  return opts?.sessionsDir ?? getSessionsDir();
}

/**
 * Generate a collision-safe session ID: timestamp + random suffix.
 */
export function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = [
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

  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rand}`;
}

export async function saveSessionMeta(
  meta: SessionMeta,
  opts?: SessionsStoreOptions
): Promise<void> {
  const sessionsDir = resolveSessionsDir(opts);
  mkdirSync(sessionsDir, { recursive: true });
  // JSON preserves multi-line prompts without escaping issues
  await Bun.write(
    `${sessionsDir}/${meta.timestamp}.json`,
    JSON.stringify(meta, null, 2)
  );
}

export async function listSessions(opts?: SessionsStoreOptions): Promise<SessionMeta[]> {
  try {
    const sessionsDir = resolveSessionsDir(opts);
    mkdirSync(sessionsDir, { recursive: true });
    const files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".json") || f.endsWith(".meta"))
      .sort()
      .reverse();

    const sessions: SessionMeta[] = [];
    for (const file of files) {
      const meta = await readSessionMeta(`${sessionsDir}/${file}`);
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

    // New JSON format
    if (path.endsWith(".json")) {
      return JSON.parse(text) as SessionMeta;
    }

    // Legacy .meta key=value format (read-only compat)
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

/**
 * Load a single session by ID. Tries .json first, then legacy .meta.
 */
export async function getSessionMeta(
  sessionId: string,
  opts?: SessionsStoreOptions
): Promise<SessionMeta | null> {
  const sessionsDir = resolveSessionsDir(opts);
  const jsonPath = `${sessionsDir}/${sessionId}.json`;
  const meta = await readSessionMeta(jsonPath);
  if (meta) return meta;

  // Fallback to legacy format
  const metaPath = `${sessionsDir}/${sessionId}.meta`;
  return readSessionMeta(metaPath);
}

export function getLogPath(sessionId: string, opts?: SessionsStoreOptions): string {
  return `${resolveSessionsDir(opts)}/${sessionId}.log`;
}

export function formatSessionLine(meta: SessionMeta): string {
  const icon = meta.status === "complete" ? "\u00B7" : "\u25CB";
  const short =
    meta.prompt.length > 40 ? meta.prompt.slice(0, 40) + "..." : meta.prompt;
  return `${icon} ${meta.timestamp}  ${meta.model}  ${short}`;
}
