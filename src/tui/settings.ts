// ─── Settings Editor ──────────────────────────────────────────────────────────

import * as p from "@clack/prompts";
import type Fuse from "fuse.js";
import type { Config, ModelInfo } from "../types.js";
import { saveConfig } from "../core/config.js";
import { searchModels } from "../core/models.js";

interface SettingsOptions {
  config: Config;
  models: ModelInfo[];
  fuse: Fuse<ModelInfo>;
}

export async function settingsFlow(opts: SettingsOptions): Promise<Config> {
  const { config, models, fuse } = opts;
  const updated = { ...config };

  while (true) {
    const choice = await p.select({
      message: "SETTINGS",
      options: [
        {
          value: "model",
          label: `Default model:          ${updated.defaultModel || "<not set>"}`,
        },
        {
          value: "thinking",
          label: `Default thinking:       ${updated.defaultThinking}`,
        },
        {
          value: "maxiter",
          label: `Default max iterations: ${updated.defaultMaxIter}`,
        },
        { value: "save", label: "Save & back" },
      ],
    });

    if (p.isCancel(choice)) return config; // discard changes

    if (choice === "save") {
      await saveConfig(updated);
      p.log.success("Settings saved.");
      return updated;
    }

    if (choice === "model") {
      const modelOptions = models.map((m) => ({
        value: m.id,
        label: m.id,
        hint: m.name !== m.modelID ? m.name : undefined,
      }));

      // Memoize search results per query to avoid O(n²) per keystroke
      let lastQuery = "";
      let matchSet: Set<string> = new Set();

      const result = await p.autocomplete({
        message: "Default model",
        options: modelOptions,
        placeholder: "Search models...",
        initialUserInput: updated.defaultModel || undefined,
        filter(search, option) {
          if (!search) return true;
          if (search !== lastQuery) {
            lastQuery = search;
            matchSet = new Set(searchModels(fuse, search).map((m) => m.id));
          }
          return matchSet.has(option.value as string);
        },
      });

      if (!p.isCancel(result)) {
        updated.defaultModel = result as string;
      }
    }

    if (choice === "thinking") {
      // Default thinking is a variant name hint.
      // Since available variants vary per model, we use a text input
      // with common suggestions. The actual variant is validated at
      // session time against the selected model's variants.
      const result = await p.text({
        message: "Default thinking variant",
        placeholder: 'off, low, medium, high, max, etc.',
        defaultValue: updated.defaultThinking,
      });

      if (!p.isCancel(result)) {
        updated.defaultThinking = (result as string).trim() || "off";
      }
    }

    if (choice === "maxiter") {
      const result = await p.text({
        message: "Default max iterations",
        defaultValue: String(updated.defaultMaxIter),
        validate(val: string | undefined) {
          const n = parseInt(val ?? "", 10);
          if (isNaN(n) || n < 1) return "Enter a positive number";
        },
      });

      if (!p.isCancel(result)) {
        updated.defaultMaxIter = parseInt(result as string, 10);
      }
    }
  }
}
