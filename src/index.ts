#!/usr/bin/env bun
// ─── ralph — Autonomous OpenCode Agent ────────────────────────────────────────
// Entry point: CLI parsing + TUI/CLI mode router.

import * as p from "@clack/prompts";
import { loadConfig } from "./core/config.js";
import { fetchModels, getModels, createModelSearcher, searchModels } from "./core/models.js";
import { runSession, runOnce } from "./core/runner.js";
import { menuLoop } from "./tui/menu.js";
import type { ModelInfo } from "./types.js";

// ─── CLI Parsing ──────────────────────────────────────────────────────────────

interface CliArgs {
  model: string;
  /** Thinking variant name, or "off" */
  thinking: string;
  maxIter: number;
  once: boolean;
  tui: boolean;
  refresh: boolean;
  help: boolean;
  prompt: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    model: process.env.RALPH_MODEL ?? "",
    thinking: "off",
    maxIter: parseInt(process.env.RALPH_MAX_ITER ?? "50", 10) || 50,
    once: false,
    tui: false,
    refresh: false,
    help: false,
    prompt: "",
  };

  const rest = argv.slice(2); // skip bun and script path
  let i = 0;

  while (i < rest.length) {
    const arg = rest[i];

    switch (arg) {
      case "-m":
      case "--model":
        args.model = rest[++i] ?? "";
        break;
      case "--thinking":
        args.thinking = rest[++i] ?? "off";
        break;
      case "--max-iter":
        args.maxIter = parseInt(rest[++i] ?? "50", 10) || 50;
        break;
      case "--once":
        args.once = true;
        break;
      case "--refresh":
        args.refresh = true;
        break;
      case "--tui":
        args.tui = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        // Everything else is the prompt
        args.prompt = rest.slice(i).join(" ");
        i = rest.length;
        break;
    }
    i++;
  }

  return args;
}

function printUsage(): void {
  console.log(`Usage: ralph [options] [prompt]

Autonomous OpenCode agent.

With no arguments, opens the interactive TUI.
With a prompt, runs directly in the terminal.

Options:
  -m, --model <provider/model>   Model to use (or set RALPH_MODEL env var)
  --thinking <variant>           Thinking variant name (default: off)
  --max-iter <n>                 Max loop iterations (default: 50, or RALPH_MAX_ITER)
  --once                         Run a single invocation without looping
  --refresh                      Force refresh the model cache
  --tui                          Open the interactive TUI
  -h, --help                     Show this help message

Examples:
  ralph                                             # interactive TUI
  ralph "Fix all failing E2E tests"                 # direct mode
  ralph -m anthropic/claude-sonnet-4-20250514 "Refactor auth"
  ralph --thinking high "Solve this complex bug"
  ralph --max-iter 5 "Add input validation"
  ralph --once "Explain the auth flow"`);
}

// ─── Model Loading ────────────────────────────────────────────────────────────

async function loadModels(forceRefresh = false): Promise<ModelInfo[]> {
  const s = p.spinner();
  s.start(forceRefresh ? "Refreshing models from OpenCode..." : "Loading models...");

  try {
    const models = await getModels(forceRefresh);
    s.stop(`Loaded ${models.length} models.`);
    return models;
  } catch (err) {
    s.stop("Failed to load models from SDK.");

    // Fallback: try parsing `opencode models` CLI output
    p.log.warning("Falling back to CLI model discovery...");
    return await fallbackModelList();
  }
}

async function fallbackModelList(): Promise<ModelInfo[]> {
  const { findOpencodeBin } = await import("./core/runner.js");

  try {
    const bin = await findOpencodeBin();
    const proc = Bun.spawn([bin, "models"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const text = await new Response(proc.stdout).text();
    await proc.exited;

    const models: ModelInfo[] = [];
    for (const line of text.split("\n")) {
      const id = line.trim();
      if (!id || !id.includes("/")) continue;
      const [providerID, ...rest] = id.split("/");
      const modelID = rest.join("/");
      models.push({
        id,
        name: modelID,
        providerID,
        modelID,
        reasoning: false, // unknown from CLI
        variants: {},
      });
    }
    return models;
  } catch {
    return [];
  }
}

/**
 * Resolve variant config for CLI mode.
 * Looks up the thinking variant name in the model's variants map.
 */
function resolveVariantConfig(
  thinking: string,
  modelInfo?: ModelInfo
): Record<string, unknown> | null {
  if (thinking === "off" || !modelInfo) return null;
  return modelInfo.variants[thinking] ?? null;
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // No args or --tui → TUI mode
  if (!args.prompt && !args.tui) {
    args.tui = true;
  }

  if (args.tui) {
    const config = await loadConfig();
    const models = await loadModels(args.refresh);

    if (models.length === 0) {
      p.log.error("No models available. Is OpenCode configured?");
      process.exit(1);
    }

    const fuse = createModelSearcher(models);
    await menuLoop({ config, models, fuse });
    return;
  }

  // CLI mode with prompt
  if (!args.prompt) {
    console.error("Error: No prompt provided.\n");
    printUsage();
    process.exit(1);
  }

  // Interactive model selection if none specified
  if (!args.model) {
    const config = await loadConfig();
    if (config.defaultModel) {
      args.model = config.defaultModel;
    } else {
      const models = await loadModels(args.refresh);
      if (models.length === 0) {
        console.error("No model specified. Use -m or set RALPH_MODEL.");
        process.exit(1);
      }

      const fuse = createModelSearcher(models);

      // Memoize search results per query to avoid O(n²) per keystroke
      let lastQuery = "";
      let matchSet: Set<string> = new Set();

      const result = await p.autocomplete({
        message: "Select a model",
        options: models.map((m) => ({
          value: m.id,
          label: m.id,
          hint: m.name !== m.modelID ? m.name : undefined,
        })),
        placeholder: "Search models...",
        filter(search, option) {
          if (!search) return true;
          if (search !== lastQuery) {
            lastQuery = search;
            matchSet = new Set(searchModels(fuse, search).map((m) => m.id));
          }
          return matchSet.has(option.value as string);
        },
      });

      if (p.isCancel(result)) process.exit(0);
      args.model = result as string;
    }
  }

  // Load models to get modelInfo for variant config resolution
  let modelInfo: ModelInfo | undefined;
  try {
    const models = await getModels(args.refresh);
    modelInfo = models.find((m) => m.id === args.model);
  } catch {
    // Can't load SDK data, proceed without it
  }

  const variantConfig = resolveVariantConfig(args.thinking, modelInfo);

  // Warn if thinking was requested but no variant found
  if (args.thinking !== "off" && !variantConfig && modelInfo) {
    const available = Object.keys(modelInfo.variants);
    if (available.length > 0) {
      console.error(
        `Warning: variant "${args.thinking}" not found for ${args.model}. Available: ${available.join(", ")}`
      );
    } else {
      console.error(
        `Warning: no thinking variants available for ${args.model}.`
      );
    }
  }

  // Single-run mode
  if (args.once) {
    await runOnce(args.model, args.thinking, args.prompt, variantConfig);
    return;
  }

  // Loop mode
  await runSession({
    model: args.model,
    thinking: args.thinking,
    maxIter: args.maxIter,
    prompt: args.prompt,
    variantConfig,
    onIteration(current, max) {
      console.log(`\n[${current}/${max}]\n`);
    },
    onComplete(iterations) {
      console.log(`\n[complete: ${iterations} iterations]`);
    },
    onMaxReached(max) {
      console.log(`\n[max iterations reached: ${max}]`);
      console.log(
        "  the agent may not have finished. re-run or increase --max-iter."
      );
    },
  });
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
