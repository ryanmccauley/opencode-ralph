// ─── OpenCode JSONL Parser ────────────────────────────────────────────────────
// Converts `opencode run --format json` JSONL events into internal
// RenderEvents consumed by the tree renderer.
//
// OpenCode event types (from the JSON stream):
//   step_start   – beginning of a processing step
//   tool_use     – tool invocation (emitted on completion)
//   text         – assistant prose (accumulated, not rendered)
//   step_finish  – end of a step (reason: "stop" | "tool-calls")
//   error        – error event

import type { RenderEvent } from "./events.js";

// ─── OpenCode event shapes ──────────────────────────────────────────────────

export interface OcStepStart {
  type: "step_start";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: string;
  };
}

export interface OcToolUse {
  type: "tool_use";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: "tool";
    callID: string;
    tool: string;
    state: {
      status: "completed";
      input: Record<string, unknown>;
      output?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };
  };
}

export interface OcText {
  type: "text";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    type: "text";
    text: string;
  };
}

export interface OcStepFinish {
  type: "step_finish";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: "step-finish";
    reason?: "stop" | "tool-calls";
    cost?: number;
    tokens?: {
      input: number;
      output: number;
    };
  };
}

export interface OcError {
  type: "error";
  timestamp: number;
  sessionID?: string;
  error: {
    name: string;
    data?: {
      message?: string;
    };
  };
}

export type OpencodeEvent =
  | OcStepStart
  | OcToolUse
  | OcText
  | OcStepFinish
  | OcError;

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse a single JSONL line into an OpenCode event.
 * Returns null for lines that can't be parsed.
 */
export function parseLine(line: string): OpencodeEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj === "object" && obj !== null && typeof obj.type === "string") {
      return obj as OpencodeEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a human-readable one-line label for a tool event.
 *
 * Priority:
 *   1. part.state.title (set by each tool's execute function)
 *   2. Extract key param from input for known tools
 *   3. Just the tool name
 */
export function toolLabel(tool: string, state: OcToolUse["part"]["state"]): string {
  if (state.title) {
    return `${tool}: ${state.title}`;
  }

  // Fallback: extract useful info from input for known tools
  const input = state.input;
  switch (tool) {
    case "bash":
      return input.description
        ? `bash: ${input.description}`
        : input.command
          ? `bash: ${String(input.command).slice(0, 60)}`
          : "bash";
    case "read":
      return input.filePath ? `read: ${input.filePath}` : "read";
    case "write":
      return input.filePath ? `write: ${input.filePath}` : "write";
    case "edit":
      return input.filePath ? `edit: ${input.filePath}` : "edit";
    case "grep":
      return input.pattern ? `grep: "${input.pattern}"` : "grep";
    case "glob":
      return input.pattern ? `glob: ${input.pattern}` : "glob";
    case "task": {
      const desc = input.description ?? input.prompt;
      return desc ? `task: ${String(desc).slice(0, 60)}` : "task";
    }
    default:
      return tool;
  }
}

/**
 * Convert an OpenCode event into zero or more RenderEvents.
 *
 * Some OpenCode events don't map to render events (e.g. text events are
 * accumulated silently). Some map to multiple render events (e.g. a
 * tool_use with an error produces ToolStart + ToolEnd with error).
 */
export function toRenderEvents(event: OpencodeEvent): RenderEvent[] {
  switch (event.type) {
    case "step_start":
      // step_start marks a new processing step. We use the first one
      // as the session start signal; subsequent ones are internal.
      return [];

    case "tool_use": {
      const { part } = event;
      const label = toolLabel(part.tool, part.state);

      // Check for task tool (subagent invocation)
      if (part.tool === "task") {
        const events: RenderEvent[] = [];
        const agentName = part.state.input.subagent_type
          ?? part.state.input.description
          ?? "task";
        events.push({
          type: "agent_start",
          name: String(agentName),
          sessionId: part.callID,
        });
        events.push({
          type: "agent_end",
          sessionId: part.callID,
        });
        return events;
      }

      const events: RenderEvent[] = [];

      // Emit ToolStart
      events.push({
        type: "tool_start",
        tool: part.tool,
        title: label,
        callId: part.callID,
      });

      // Immediately emit ToolEnd (JSON stream only gives completed tools)
      const hasError = part.state.metadata?.exit !== undefined &&
        part.state.metadata.exit !== 0;
      events.push({
        type: "tool_end",
        callId: part.callID,
        tool: part.tool,
        output: hasError ? undefined : part.state.output,
        error: hasError
          ? `exit code ${part.state.metadata!.exit}`
          : undefined,
      });

      return events;
    }

    case "text": {
      // Strip internal control tokens from the text before rendering
      const raw = event.part.text ?? "";
      const cleaned = raw
        .replace(/<ralph>DONE<\/ralph>/g, "")
        .trim();
      if (!cleaned) return [];
      return [{
        type: "text_content",
        text: cleaned,
      }];
    }

    case "step_finish":
      // step_finish with reason "stop" means the model stopped generating.
      // step_finish with reason "tool-calls" is an internal boundary.
      // Neither maps directly to our render events; the runner handles
      // session-level completion via DONE_TOKEN detection.
      return [];

    case "error":
      return [{
        type: "warn",
        message: event.error.data?.message ?? event.error.name,
      }];

    default:
      return [];
  }
}

/**
 * Streaming line buffer for JSONL input.
 *
 * Feed it chunks from stdout and it yields complete lines.
 * Handles partial lines across chunk boundaries.
 */
export class LineBuffer {
  private partial = "";

  /**
   * Add a chunk of data and return any complete lines.
   */
  push(chunk: string): string[] {
    this.partial += chunk;
    const lines: string[] = [];

    let newlineIdx: number;
    while ((newlineIdx = this.partial.indexOf("\n")) !== -1) {
      lines.push(this.partial.slice(0, newlineIdx));
      this.partial = this.partial.slice(newlineIdx + 1);
    }

    return lines;
  }

  /**
   * Flush any remaining partial line (call at end of stream).
   */
  flush(): string | null {
    if (this.partial.trim()) {
      const line = this.partial;
      this.partial = "";
      return line;
    }
    this.partial = "";
    return null;
  }
}
