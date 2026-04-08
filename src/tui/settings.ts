// ─── Settings Editor ──────────────────────────────────────────────────────────

import * as p from "@clack/prompts";
import type Fuse from "fuse.js";
import type { Config, ModelInfo } from "../types.js";
import { saveConfig } from "../core/config.js";
import { selectModel, validatePositiveInt } from "./helpers.js";

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
      const result = await selectModel(models, fuse, {
        message: "Default model",
        initial: updated.defaultModel,
      });
      if (result) {
        updated.defaultModel = result;
      }
    }

    if (choice === "thinking") {
      const result = await p.text({
        message: "Default thinking variant",
        placeholder: "off, low, medium, high, max, etc.",
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
        validate: validatePositiveInt,
      });

      if (!p.isCancel(result)) {
        updated.defaultMaxIter = parseInt(result as string, 10);
      }
    }
  }
}
