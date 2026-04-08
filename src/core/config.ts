// ─── Ralph Config Management ──────────────────────────────────────────────────
// Persists user defaults to ~/.ralph/config

import { homedir } from "os";
import { join } from "path";
import { type Config, DEFAULT_CONFIG } from "../types.js";

const RALPH_DIR = process.env.RALPH_HOME ?? join(homedir(), ".ralph");
const CONFIG_FILE = join(RALPH_DIR, "config");

export const RALPH_HOME = RALPH_DIR;
export const SESSIONS_DIR = join(RALPH_DIR, "sessions");

export async function loadConfig(): Promise<Config> {
  const config = { ...DEFAULT_CONFIG };

  // Env var overrides
  if (process.env.RALPH_MODEL) config.defaultModel = process.env.RALPH_MODEL;
  if (process.env.RALPH_MAX_ITER)
    config.defaultMaxIter = parseInt(process.env.RALPH_MAX_ITER, 10) || 50;

  // Load from file
  try {
    const file = Bun.file(CONFIG_FILE);
    if (await file.exists()) {
      const text = await file.text();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        // Strip surrounding quotes
        const val = trimmed
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        switch (key) {
          case "DEFAULT_MODEL":
            if (val) config.defaultModel = val;
            break;
          case "DEFAULT_THINKING":
            if (val) config.defaultThinking = val as Config["defaultThinking"];
            break;
          case "DEFAULT_MAX_ITER":
            if (val) config.defaultMaxIter = parseInt(val, 10) || 50;
            break;
        }
      }
    }
  } catch {
    // Ignore read errors, use defaults
  }

  return config;
}

export async function saveConfig(config: Config): Promise<void> {
  const { mkdirSync } = await import("fs");
  mkdirSync(RALPH_DIR, { recursive: true });

  const content = [
    `DEFAULT_MODEL="${config.defaultModel}"`,
    `DEFAULT_THINKING="${config.defaultThinking}"`,
    `DEFAULT_MAX_ITER="${config.defaultMaxIter}"`,
    "",
  ].join("\n");

  await Bun.write(CONFIG_FILE, content);
}
