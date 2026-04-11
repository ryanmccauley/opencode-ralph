// ─── Shared TUI Helpers ───────────────────────────────────────────────────────
// Deduplicates autocomplete model picker, run-session callbacks, and input
// validation logic used across new-session, settings, sessions, and index.

import * as p from "@clack/prompts";
import type Fuse from "fuse.js";
import type { ModelInfo } from "../types.js";
import { searchModels } from "../core/models.js";
import type { RunOptions } from "../core/runner.js";

/**
 * Show the fuzzy model-search autocomplete picker.
 * Returns the selected model ID, or null if cancelled.
 */
export async function selectModel(
  models: ModelInfo[],
  fuse: Fuse<ModelInfo>,
  opts?: { message?: string; initial?: string }
): Promise<string | null> {
  const modelOptions = models.map((m) => ({
    value: m.id,
    label: m.id,
    hint: m.name !== m.modelID ? m.name : undefined,
  }));

  // Memoize search results per query to avoid O(n^2) per keystroke
  let lastQuery = "";
  let matchSet: Set<string> = new Set();

  const result = await p.autocomplete({
    message: opts?.message ?? "MODEL",
    options: modelOptions,
    placeholder: "Search models...",
    initialUserInput: opts?.initial || undefined,
    filter(search, option) {
      if (!search) return true;
      if (search !== lastQuery) {
        lastQuery = search;
        matchSet = new Set(searchModels(fuse, search).map((m) => m.id));
      }
      return matchSet.has(option.value as string);
    },
  });

  if (p.isCancel(result)) return null;
  return result as string;
}

/**
 * Default run-session callbacks for terminal output.
 * Used by TUI flows and CLI mode so the logging is consistent.
 *
 * Note: onIteration is intentionally omitted — the status bar handles
 * iteration display when active, and omitting it avoids noisy log lines
 * when the bar is disabled too.
 *
 * @param useRenderer - When true, session-end display is handled by the
 *   TreeRenderer. When false, callbacks log directly to console.
 */
export function createRunCallbacks(useRenderer = true): Pick<
  RunOptions,
  "onComplete" | "onMaxReached"
> {
  if (useRenderer) {
    return {
      onComplete(_iterations) {
        // Session end is rendered by the TreeRenderer via session_end event.
      },
      onMaxReached(_max) {
        // Session end is rendered by the TreeRenderer via session_end event.
      },
    };
  }

  return {
    onComplete(iterations) {
      console.log(`\ncomplete, ${iterations} ${iterations === 1 ? "iteration" : "iterations"}`);
    },
    onMaxReached(max) {
      console.log(`\nincomplete, max iterations reached (${max})`);
    },
  };
}

/**
 * Parse a string as a positive integer, returning null on failure.
 */
export function parsePositiveInt(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return !isNaN(n) && n > 0 ? n : fallback;
}

/**
 * Validate that a value is a positive integer string.
 * Returns an error message or undefined.
 */
export function validatePositiveInt(val: string | undefined): string | undefined {
  const n = parseInt(val ?? "", 10);
  if (isNaN(n) || n < 1) return "Enter a positive number";
}
