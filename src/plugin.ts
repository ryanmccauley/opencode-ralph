import { join } from "path";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import {
  DEFAULT_MAX_ITERATIONS,
  DONE_TOKEN,
  RALPH_AGENT_CONFIG,
  RALPH_AGENT_NAME,
  RALPH_COMMANDS,
  RALPH_CONTINUATION_PROMPT,
} from "./plugin/constants.js";
import { formatRunStatus, parseIterationLimit } from "./plugin/commands.js";
import {
  createRunState,
  createSyntheticMessageID,
  shouldAutoContinue,
  shouldEvaluateIdle,
  type RalphRunState,
} from "./plugin/runtime.js";
import { RalphStateStore } from "./plugin/state.js";

type PluginCommandInput = {
  command?: string;
  name?: string;
  arguments?: string;
  sessionID?: string;
};

type PluginCommandOutput = {
  parts?: unknown[];
};

function isRalphCommand(name: string): name is keyof typeof RALPH_COMMANDS {
  return Object.hasOwn(RALPH_COMMANDS, name);
}

function mergeRalphAgent(existing: Record<string, unknown> | undefined) {
  return {
    ...RALPH_AGENT_CONFIG,
    ...existing,
    permission: {
      ...RALPH_AGENT_CONFIG.permission,
      ...(existing?.permission as Record<string, unknown> | undefined),
      bash: {
        ...RALPH_AGENT_CONFIG.permission.bash,
        ...((existing?.permission as { bash?: Record<string, unknown> } | undefined)
          ?.bash ?? {}),
      },
    },
    prompt:
      typeof existing?.prompt === "string"
        ? existing.prompt
        : RALPH_AGENT_CONFIG.prompt,
  };
}

async function showToast(
  client: any,
  message: string,
  variant: "info" | "success" | "warning" | "error" = "info"
): Promise<void> {
  try {
    await client.tui.showToast({
      body: {
        message,
        variant,
      },
    });
  } catch {
    // Ignore TUI transport failures.
  }
}

export const RalphPlugin: Plugin = async (ctx: any) => {
  const statePath = join(ctx.worktree ?? ctx.directory, ".opencode", "ralph-state.json");
  const store = new RalphStateStore(statePath, DEFAULT_MAX_ITERATIONS);

  async function continueRun(sessionID: string, run: RalphRunState): Promise<void> {
    const nextMessageID = createSyntheticMessageID();

    store.update(sessionID, (session) => {
      if (!session.run || session.run.id !== run.id) {
        return session;
      }

      session.run.iteration += 1;
      session.run.activePromptMessageID = nextMessageID;
      session.run.syntheticMessageIDs.push(nextMessageID);
      session.run.updatedAt = Date.now();
      return session;
    });

    try {
      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: {
          messageID: nextMessageID,
          agent: RALPH_AGENT_NAME,
          parts: [
            {
              type: "text",
              text: RALPH_CONTINUATION_PROMPT,
              synthetic: true,
              metadata: {
                source: "ralph-plugin",
              },
            },
          ],
        },
      });
    } catch (error) {
      store.update(sessionID, (session) => {
        if (!session.run || session.run.id !== run.id) {
          return session;
        }

        session.run.status = "error";
        session.run.pauseReason = "error";
        session.run.waitReason =
          error instanceof Error ? error.message : String(error);
        return session;
      });
      await showToast(
        ctx.client,
        "Ralph failed to continue the current run.",
        "error"
      );
    }
  }

  async function handleCommand(
    name: keyof typeof RALPH_COMMANDS,
    argumentsText: string,
    sessionID: string
  ): Promise<void> {
    if (name === "ralph-limit") {
      const parsed = parseIterationLimit(argumentsText);
      if (!parsed) {
        await showToast(
          ctx.client,
          "Ralph limit must be a positive integer.",
          "warning"
        );
        return;
      }

      const next = store.update(sessionID, (session) => {
        session.defaultMaxIterations = parsed;
        if (session.run) {
          session.run.maxIterations = parsed;
        }
        return session;
      });

      await showToast(
        ctx.client,
        `Ralph limit set to ${next.run?.maxIterations ?? next.defaultMaxIterations}.`,
        "success"
      );
      return;
    }

    if (name === "ralph-status") {
      const session = store.get(sessionID);
      await showToast(ctx.client, formatRunStatus(session), "info");
      return;
    }

    if (name === "ralph-pause") {
      const session = store.get(sessionID);
      if (!session.run) {
        await showToast(ctx.client, "No active Ralph run.", "warning");
        return;
      }

      store.update(sessionID, (current) => {
        if (!current.run) return current;
        current.run.status = "paused";
        current.run.pauseReason = "manual";
        return current;
      });

      try {
        await ctx.client.session.abort({ path: { id: sessionID } });
      } catch {
        // Ignore abort failures if the session is already idle.
      }

      await showToast(ctx.client, "Ralph paused.", "success");
      return;
    }

    if (name === "ralph-resume") {
      const parsed = parseIterationLimit(argumentsText);
      const session = store.update(sessionID, (current) => {
        if (!current.run) return current;
        if (parsed) {
          current.run.maxIterations = parsed;
        }
        current.run.status = "running";
        current.run.pauseReason = "none";
        current.run.waitReason = undefined;
        return current;
      });

      if (!session.run) {
        await showToast(ctx.client, "No paused Ralph run to resume.", "warning");
        return;
      }

      if (session.run.status !== "running") {
        await showToast(ctx.client, "Ralph is not resumable.", "warning");
        return;
      }

      if (!shouldAutoContinue(session.run)) {
        await showToast(
          ctx.client,
          "Ralph cannot resume without a higher iteration limit.",
          "warning"
        );
        return;
      }

      await continueRun(sessionID, session.run);
      await showToast(ctx.client, "Ralph resumed.", "success");
    }
  }

  return {
    config: async (opencodeConfig: any) => {
      opencodeConfig.agent ??= {};
      opencodeConfig.agent[RALPH_AGENT_NAME] = mergeRalphAgent(
        opencodeConfig.agent[RALPH_AGENT_NAME],
      );

      opencodeConfig.command ??= {};
      for (const [name, command] of Object.entries(RALPH_COMMANDS)) {
        if (!opencodeConfig.command[name]) {
          opencodeConfig.command[name] = command;
        }
      }
    },

    "command.execute.before": async (
      input: PluginCommandInput,
      output: PluginCommandOutput,
    ) => {
      const name = input.command ?? input.name ?? "";
      if (!isRalphCommand(name)) return;
      if (!input.sessionID) return;

      output.parts = [];
      await handleCommand(name, input.arguments ?? "", input.sessionID);
    },

    event: async ({ event }: { event: any }) => {
      if (event.type === "message.updated") {
        const message = event.properties?.info;
        if (!message) return;

        if (message.role === "user" && message.agent === RALPH_AGENT_NAME) {
          const session = store.get(message.sessionID);
          const synthetic = session.run?.syntheticMessageIDs.includes(message.id) ?? false;
          if (synthetic) return;

          store.update(message.sessionID, (current) => {
            current.run = createRunState(
              message.id,
              current.defaultMaxIterations,
            );
            return current;
          });
          return;
        }

        if (message.role === "assistant") {
          store.update(message.sessionID, (session) => {
            if (!session.run) return session;
            if (message.parentID !== session.run.activePromptMessageID) {
              return session;
            }
            session.run.lastAssistantMessageID = message.id;
            session.run.updatedAt = Date.now();
            return session;
          });
        }

        return;
      }

      if (event.type === "message.part.updated") {
        const part = event.properties?.part;
        if (!part?.sessionID) return;

        store.update(part.sessionID, (session) => {
          if (!session.run) return session;
          const currentAssistant = session.run.lastAssistantMessageID;
          if (currentAssistant && part.messageID !== currentAssistant) {
            return session;
          }

          if (part.type === "text" && typeof part.text === "string") {
            if (part.text.includes(DONE_TOKEN)) {
              session.run.sawCompletion = true;
            }
          }

          if (
            part.type === "tool" &&
            part.tool === "ralph_complete" &&
            part.state?.status === "completed"
          ) {
            session.run.sawCompletion = true;
          }

          return session;
        });
        return;
      }

      if (event.type === "session.error") {
        const sessionID = event.properties?.sessionID;
        const errorName = event.properties?.error?.name;
        if (!sessionID) return;

        store.update(sessionID, (session) => {
          if (!session.run) return session;

          if (errorName === "MessageAbortedError") {
            if (session.run.pauseReason === "manual") {
              return session;
            }
            session.run.status = "paused";
            session.run.pauseReason = "user_abort";
            return session;
          }

          session.run.status = "error";
          session.run.pauseReason = "error";
          session.run.waitReason = event.properties?.error?.data?.message;
          return session;
        });

        if (errorName !== "MessageAbortedError") {
          await showToast(ctx.client, "Ralph stopped after a session error.", "error");
        }
        return;
      }

      if (event.type === "session.idle") {
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        const session = store.get(sessionID);
        const run = session.run;
        if (!shouldEvaluateIdle(run)) return;

        const evaluated = store.update(sessionID, (current) => {
          if (!current.run) return current;
          current.run.lastEvaluatedAssistantMessageID =
            current.run.lastAssistantMessageID;
          if (current.run.sawCompletion) {
            current.run.status = "complete";
            current.run.pauseReason = "none";
            return current;
          }

          if (!shouldAutoContinue(current.run)) {
            current.run.status = "max_reached";
            current.run.pauseReason = "max_reached";
            return current;
          }

          return current;
        });

        if (!evaluated.run) return;
        if (evaluated.run.status === "complete") return;
        if (evaluated.run.status === "max_reached") {
          await showToast(
            ctx.client,
            `Ralph reached its iteration limit (${evaluated.run.maxIterations}).`,
            "warning"
          );
          return;
        }
        if (evaluated.run.status !== "running") return;

        await continueRun(sessionID, evaluated.run);
      }
    },

    tool: {
      ralph_complete: tool({
        description:
          "Signal that the Ralph agent has fully completed and verified the current task. Only Ralph should call this.",
        args: {
          summary: tool.schema
            .string()
            .optional()
            .describe("Optional short completion summary."),
        },
        async execute(args, context) {
          if (context.agent !== RALPH_AGENT_NAME) {
            return "This tool can only be called by the Ralph agent.";
          }

          store.update(context.sessionID, (session) => {
            if (!session.run) return session;
            session.run.sawCompletion = true;
            session.run.status = "complete";
            session.run.pauseReason = "none";
            session.run.waitReason = undefined;
            return session;
          });

          return args.summary
            ? `Ralph marked the task complete: ${args.summary}`
            : "Ralph marked the task complete.";
        },
      }),

      ralph_wait: tool({
        description:
          "Signal that Ralph is blocked and needs human input before continuing. Only Ralph should call this.",
        args: {
          reason: tool.schema
            .string()
            .describe("Concise reason the Ralph agent needs user input."),
        },
        async execute(args, context) {
          if (context.agent !== RALPH_AGENT_NAME) {
            return "This tool can only be called by the Ralph agent.";
          }

          store.update(context.sessionID, (session) => {
            if (!session.run) return session;
            session.run.status = "paused";
            session.run.pauseReason = "agent_wait";
            session.run.waitReason = args.reason;
            return session;
          });

          await showToast(ctx.client, `Ralph is waiting: ${args.reason}`, "info");
          return `Ralph is waiting for user input: ${args.reason}`;
        },
      }),
    },
  } as any;
};

export default RalphPlugin;
