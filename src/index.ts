#!/usr/bin/env bun
// ─── ralph — Autonomous OpenCode Agent ────────────────────────────────────────
// Entry point: CLI parsing + TUI/CLI mode router.

import * as p from "@clack/prompts";
import { loadConfig } from "./core/config.js";
import { getModels, createModelSearcher } from "./core/models.js";
import { findOpencodeBin } from "./core/opencode.js";
import { runSession, runOnce } from "./core/runner.js";
import { getSessionMeta } from "./core/sessions.js";
import { menuLoop } from "./tui/menu.js";
import {
  selectModel,
  createRunCallbacks,
  parsePositiveInt,
} from "./tui/helpers.js";
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
  noStatus: boolean;
  resume: string;
  help: boolean;
  prompt: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    model: process.env.RALPH_MODEL ?? "",
    thinking: "off",
    maxIter: parsePositiveInt(process.env.RALPH_MAX_ITER ?? "", 50),
    once: false,
    tui: false,
    refresh: false,
    noStatus: false,
    resume: "",
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
        args.maxIter = parsePositiveInt(rest[++i] ?? "", 50);
        break;
      case "--once":
        args.once = true;
        break;
      case "--refresh":
        args.refresh = true;
        break;
      case "--no-status":
        args.noStatus = true;
        break;
      case "--resume":
        args.resume = rest[++i] ?? "";
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
  --resume <session-id>          Resume an incomplete session
  --no-status                    Disable the floating status bar
  --refresh                      Force refresh the model cache
  --tui                          Open the interactive TUI
  -h, --help                     Show this help message

Examples:
  ralph                                             # interactive TUI
  ralph "Fix all failing E2E tests"                 # direct mode
  ralph -m anthropic/claude-sonnet-4-20250514 "Refactor auth"
  ralph --thinking high "Solve this complex bug"
  ralph --max-iter 5 "Add input validation"
  ralph --once "Explain the auth flow"
  ralph --resume 2026-04-08_143022_a7x3             # resume a session
  ralph --resume 2026-04-08_143022_a7x3 --max-iter 20`);
}

// ─── Model Loading ────────────────────────────────────────────────────────────

async function loadModels(forceRefresh = false): Promise<ModelInfo[]> {
  const s = p.spinner();
  s.start(forceRefresh ? "Refreshing models from OpenCode..." : "Loading models...");

  try {
    const models = await getModels(forceRefresh);
    s.stop(`Loaded ${models.length} models.`);
    return models;
  } catch {
    s.stop("Failed to load models from SDK.");

    // Fallback: try parsing `opencode models` CLI output
    p.log.warning("Falling back to CLI model discovery...");
    return await fallbackModelList();
  }
}

async function fallbackModelList(): Promise<ModelInfo[]> {
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
        reasoning: false,
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

  // ─── Resume mode ────────────────────────────────────────────────────────
  if (args.resume) {
    const meta = await getSessionMeta(args.resume);
    if (!meta) {
      console.error(`Error: session "${args.resume}" not found.`);
      process.exit(1);
    }

    if (meta.status === "complete") {
      console.error(
        `Session "${args.resume}" already completed (${meta.iterations} iterations). Nothing to resume.`
      );
      process.exit(1);
    }

    // Resolve variant config from the session's model/thinking
    let variantConfig: Record<string, unknown> | null = null;
    try {
      const models = await getModels(args.refresh);
      const modelInfo = models.find((m) => m.id === meta.model);
      if (meta.thinking !== "off" && modelInfo) {
        variantConfig = modelInfo.variants[meta.thinking] ?? null;
      }
    } catch {
      // Can't load SDK data, proceed without variant config
    }

    // --max-iter controls additional iterations; defaults to original session's maxIter
    const additionalIter = args.maxIter;

    console.log(
      `Resuming session ${meta.timestamp} from iteration ${meta.iterations}...`
    );

    await runSession({
      model: meta.model,
      thinking: meta.thinking,
      maxIter: additionalIter,
      prompt: meta.prompt,
      variantConfig,
      showStatusBar: !args.noStatus,
      resumeSessionId: meta.timestamp,
      resumeFromIteration: meta.iterations,
      ...createRunCallbacks(),
    });

    return;
  }

  // ─── No args or --tui → TUI mode ───────────────────────────────────────
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

  // ─── CLI mode with prompt ──────────────────────────────────────────────
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
      const result = await selectModel(models, fuse, {
        message: "Select a model",
      });

      if (!result) process.exit(0);
      args.model = result;
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
    await runOnce(args.model, args.prompt, variantConfig);
    return;
  }

  // Loop mode
  await runSession({
    model: args.model,
    thinking: args.thinking,
    maxIter: args.maxIter,
    prompt: args.prompt,
    variantConfig,
    showStatusBar: !args.noStatus,
    ...createRunCallbacks(),
  });
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
