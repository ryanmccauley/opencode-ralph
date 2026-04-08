// ─── Main Menu ────────────────────────────────────────────────────────────────

import * as p from "@clack/prompts";
import type { Config, ModelInfo } from "../types.js";
import type Fuse from "fuse.js";
import { getModels, createModelSearcher } from "../core/models.js";
import { newSessionFlow } from "./new-session.js";
import { sessionsFlow } from "./sessions.js";
import { settingsFlow } from "./settings.js";

interface MenuOptions {
  config: Config;
  models: ModelInfo[];
  fuse: Fuse<ModelInfo>;
}

export async function menuLoop(opts: MenuOptions): Promise<void> {
  let { config, models, fuse } = opts;

  while (true) {
    console.clear();

    const choice = await p.select({
      message: "ralph",
      options: [
        { value: "new", label: "New session" },
        { value: "sessions", label: "Recent sessions" },
        { value: "settings", label: "Settings" },
        { value: "refresh", label: "Refresh models" },
        { value: "quit", label: "Quit" },
      ],
    });

    if (p.isCancel(choice) || choice === "quit") {
      p.outro("bye");
      process.exit(0);
    }

    switch (choice) {
      case "new":
        await newSessionFlow({
          models,
          fuse,
          defaultModel: config.defaultModel,
          defaultThinking: config.defaultThinking,
          defaultMaxIter: config.defaultMaxIter,
        });
        break;

      case "sessions":
        await sessionsFlow(models);
        break;

      case "settings":
        config = await settingsFlow({ config, models, fuse });
        break;

      case "refresh": {
        const s = p.spinner();
        s.start("Refreshing models from OpenCode...");
        try {
          models = await getModels(true);
          fuse = createModelSearcher(models);
          s.stop(`Loaded ${models.length} models.`);
        } catch (err) {
          s.stop("Failed to refresh models.");
          p.log.error(String(err));
        }
        break;
      }
    }
  }
}
