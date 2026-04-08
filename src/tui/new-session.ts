// ─── New Session Flow ─────────────────────────────────────────────────────────
// model -> thinking (dynamic variants) -> iterations -> prompt -> confirm -> run

import * as p from "@clack/prompts";
import type Fuse from "fuse.js";
import type { ModelInfo } from "../types.js";
import { runSession } from "../core/runner.js";
import { dim } from "./theme.js";
import { selectModel, createRunCallbacks, validatePositiveInt } from "./helpers.js";

interface NewSessionOptions {
  models: ModelInfo[];
  fuse: Fuse<ModelInfo>;
  defaultModel: string;
  defaultThinking: string;
  defaultMaxIter: number;
}

export async function newSessionFlow(opts: NewSessionOptions): Promise<void> {
  const { models, fuse, defaultModel, defaultThinking, defaultMaxIter } = opts;

  // 1. Model selection
  const selectedModel = await selectModel(models, fuse, { initial: defaultModel });
  if (!selectedModel) return;

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
    validate: validatePositiveInt,
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
    ...createRunCallbacks(),
  });

  // Wait for user acknowledgment
  await p.text({
    message: "Press Enter to continue...",
    defaultValue: "",
  });
}
