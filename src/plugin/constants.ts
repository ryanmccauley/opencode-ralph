export const RALPH_AGENT_NAME = "ralph";
export const DONE_TOKEN = "<ralph>DONE</ralph>";
export const DEFAULT_MAX_ITERATIONS = parsePositiveInt(
  process.env.RALPH_MAX_ITER,
  50
);

export const RALPH_CONTINUATION_PROMPT =
  "Continue working on the current task. Check the current repository state and pick up where you left off. Do not stop unless the task is complete or you genuinely need human input.";

export const RALPH_AGENT_PROMPT = `You are a fully autonomous coding agent.

## Autonomy Rules (CRITICAL)

- Work autonomously. Do NOT stop to ask for user confirmation or feedback.
- Do NOT pause to summarize progress or ask \"should I continue?\" or \"would you like me to proceed?\"
- After completing one step, IMMEDIATELY move to the next.
- Keep working until the specified outcome is fully achieved.
- Only stop when the task is COMPLETE or you are genuinely stuck on something that requires human input.
- If you encounter an error, attempt to fix it yourself before asking for help.
- Re-verify your work after making changes. Run tests, builds, or whatever is appropriate to confirm the fix.

## Ralph Tools

- When the task is fully complete and verified, call the \`ralph_complete\` tool.
- If \`ralph_complete\` is unavailable for some reason, output \`${DONE_TOKEN}\` as the very last line of your final message.
- If you are genuinely blocked and require human input before you can continue, call the \`ralph_wait\` tool with a concise reason.
- Do NOT call \`ralph_wait\` for routine tradeoffs or minor uncertainty that you can resolve yourself.`;

export const RALPH_AGENT_CONFIG = {
  description: "Autonomous agent that works until the task is fully complete",
  mode: "primary",
  temperature: 0.7,
  color: "#FFFFFF",
  permission: {
    edit: "allow",
    bash: {
      "*": "allow",
    },
    webfetch: "allow",
  },
  prompt: RALPH_AGENT_PROMPT,
} as const;

export const RALPH_COMMANDS = {
  "ralph-limit": {
    description: "Set Ralph iteration limit",
    template:
      "Ralph control command. Set the iteration limit for the current session to $ARGUMENTS.",
  },
  "ralph-pause": {
    description: "Pause the current Ralph run",
    template: "Ralph control command. Pause the current Ralph run.",
  },
  "ralph-resume": {
    description: "Resume the current Ralph run",
    template:
      "Ralph control command. Resume the current Ralph run, optionally using the iteration limit in $ARGUMENTS.",
  },
  "ralph-status": {
    description: "Show Ralph status",
    template: "Ralph control command. Show the Ralph status for this session.",
  },
} as const;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
