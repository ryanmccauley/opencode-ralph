// ─── New Session Flow ─────────────────────────────────────────────────────────
// model → thinking (dynamic variants) → iterations → prompt → confirm → run

import * as p from "@clack/prompts";
import type Fuse from "fuse.js";
import type { ModelInfo } from "../types.js";
import { searchModels } from "../core/models.js";
import { runSession } from "../core/runner.js";
import { dim } from "./theme.js";

interface NewSessionOptions {
  models: ModelInfo[];
  fuse: Fuse<ModelInfo>;
  defaultModel: string;
  defaultThinking: string;
  defaultMaxIter: number;
}

export async function newSessionFlow(opts: NewSessionOptions): Promise<void> {
  const { models, fuse, defaultModel, defaultThinking, defaultMaxIter } = opts;

  // 1. Model selection (autocomplete with fuzzy search)
  const modelOptions = models.map((m) => ({
    value: m.id,
    label: m.id,
    hint: m.name !== m.modelID ? m.name : undefined,
  }));

  // Memoize search results per query to avoid O(n²) per keystroke
  let lastQuery = "";
  let matchSet: Set<string> = new Set();

  const modelResult = await p.autocomplete({
    message: "MODEL",
    options: modelOptions,
    placeholder: "Search models...",
    initialUserInput: defaultModel || undefined,
    filter(search, option) {
      if (!search) return true;
      if (search !== lastQuery) {
        lastQuery = search;
        matchSet = new Set(searchModels(fuse, search).map((m) => m.id));
      }
      return matchSet.has(option.value as string);
    },
  });

  if (p.isCancel(modelResult)) return;
  const selectedModel = modelResult as string;

  // Find the model info for thinking config
  const modelInfo = models.find((m) => m.id === selectedModel);
  if (!modelInfo) {
    p.log.error("Model not found in registry.");
    return;
  }

  // 2. Thinking variant (only if model has variants)
  let thinking = "off";
  let variantConfig: Record<string, unknown> | null = null;

  const variantNames = Object.keys(modelInfo.variants);

  if (modelInfo.reasoning && variantNames.length > 0) {
    const thinkingOptions = [
      { value: "off", label: "off" },
      ...variantNames.map((name) => ({ value: name, label: name })),
    ];

    // Try to match the default thinking to an available variant
    const initialValue = variantNames.includes(defaultThinking)
      ? defaultThinking
      : "off";

    const thinkingResult = await p.select({
      message: "THINKING",
      options: thinkingOptions,
      initialValue,
    });

    if (p.isCancel(thinkingResult)) return;
    thinking = thinkingResult as string;

    if (thinking !== "off") {
      variantConfig = modelInfo.variants[thinking] ?? null;
    }
  } else if (!modelInfo.reasoning) {
    p.log.message(dim("Thinking not available for this model, skipping."));
  } else {
    p.log.message(dim("No thinking variants defined for this model, skipping."));
  }

  // 3. Max iterations
  const maxIterResult = await p.text({
    message: "MAX ITERATIONS",
    placeholder: "50",
    defaultValue: String(defaultMaxIter),
    validate(val: string | undefined) {
      const n = parseInt(val ?? "", 10);
      if (isNaN(n) || n < 1) return "Enter a positive number";
    },
  });

  if (p.isCancel(maxIterResult)) return;
  const maxIter = parseInt(maxIterResult as string, 10);

  // 4. Prompt
  const promptResult = await p.text({
    message: "PROMPT",
    placeholder: "Describe the task...",
    validate(val: string | undefined) {
      if (!val?.trim()) return "Prompt cannot be empty";
    },
  });

  if (p.isCancel(promptResult)) return;
  const prompt = (promptResult as string).trim();

  // 5. Confirmation
  const pad = (label: string) => label.padEnd(14);
  const summary = [
    `${pad("Model")} ${selectedModel}`,
    `${pad("Thinking")} ${thinking}`,
    `${pad("Max iter")} ${maxIter}`,
    ``,
    `${pad("Prompt")}`,
    `${prompt}`,
  ].join("\n");

  p.box(summary, "Session");

  const confirmed = await p.confirm({
    message: "Start session?",
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) return;

  // 6. Run
  await runSession({
    model: selectedModel,
    thinking,
    maxIter,
    prompt,
    variantConfig,
    onIteration(current, max) {
      console.log(`\n[${current}/${max}]\n`);
    },
    onComplete(iterations) {
      console.log(`\n[complete: ${iterations} iterations]`);
    },
    onMaxReached(max) {
      console.log(`\n[max iterations reached: ${max}]`);
      console.log("  the agent may not have finished. re-run or increase --max-iter.");
    },
  });

  // Wait for user acknowledgment
  await p.text({
    message: "Press Enter to continue...",
    defaultValue: "",
  });
}
