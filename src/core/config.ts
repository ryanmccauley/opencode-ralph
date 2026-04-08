// ─── Ralph Config Management ──────────────────────────────────────────────────
// Persists user defaults to ~/.ralph/config
//
// Precedence (highest wins): CLI flags > env vars > saved config file > defaults

import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { type Config, DEFAULT_CONFIG } from "../types.js";

const DEFAULT_RALPH_DIR = join(homedir(), ".ralph");

/** Resolve Ralph's home directory at call-time (env-aware). */
export function getRalphHome(): string {
  return process.env.RALPH_HOME ?? DEFAULT_RALPH_DIR;
}

/** Resolve Ralph's config file path at call-time (env-aware). */
export function getConfigFile(): string {
  return join(getRalphHome(), "config");
}

/** Resolve Ralph's sessions directory at call-time (env-aware). */
export function getSessionsDir(): string {
  return join(getRalphHome(), "sessions");
}

// Backward-compatible snapshots (prefer the getters above in new code)
export const RALPH_HOME = getRalphHome();
export const SESSIONS_DIR = getSessionsDir();

/**
 * Load config with correct precedence: defaults < saved file < env vars.
 * CLI flags are applied by the caller on top of the returned config.
 */
export async function loadConfig(): Promise<Config> {
  const configFile = getConfigFile();

  // 1. Start with defaults
  const config: Config = { ...DEFAULT_CONFIG };

  // 2. Layer saved config file on top
  try {
    const file = Bun.file(configFile);
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
            if (val) config.defaultThinking = val;
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

  // 3. Layer env vars on top (env beats saved file)
  if (process.env.RALPH_MODEL) config.defaultModel = process.env.RALPH_MODEL;
  if (process.env.RALPH_MAX_ITER) {
    const n = parseInt(process.env.RALPH_MAX_ITER, 10);
    if (n > 0) config.defaultMaxIter = n;
  }

  return config;
}

export async function saveConfig(config: Config): Promise<void> {
  const ralphDir = getRalphHome();
  const configFile = getConfigFile();
  mkdirSync(ralphDir, { recursive: true });

  const content = [
    `DEFAULT_MODEL="${config.defaultModel}"`,
    `DEFAULT_THINKING="${config.defaultThinking}"`,
    `DEFAULT_MAX_ITER="${config.defaultMaxIter}"`,
    "",
  ].join("\n");

  await Bun.write(configFile, content);
}
