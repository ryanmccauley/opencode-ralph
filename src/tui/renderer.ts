// ─── Tree Renderer ────────────────────────────────────────────────────────────
// Orchestrates TreeState, Spinner, and JSON parsing to produce the shard-tree
// TUI output.
//
// Output format:
//   [session] Fix all failing tests
//
//     ╭─ [agent] explore
//     │  ╭─ [tool] grep: "handleError"
//     │  ├─ [tool] read: src/core/runner.ts
//     │  ╰─ [tool] read: src/tui/status-bar.ts
//     │
//     ╰─ [agent] general
//        ╭─ [tool] bash: Run test suite
//        │    126 passed
//        ╰─ [tool] write: src/tui/renderer.ts
//
//   complete, 3 iterations

import { TreeState } from "./tree.js";
import { Spinner } from "./spinner.js";
import type { RenderEvent } from "./events.js";
import {
  parseLine,
  toRenderEvents,
  LineBuffer,
  type OpencodeEvent,
} from "./json-parser.js";

// ─── Indent constants ────────────────────────────────────────────────────────

/** Base indentation before the tree structure starts. */
const BASE_INDENT = "  ";

/** Extra indentation for tool output lines under their tool. */
const OUTPUT_INDENT = "   ";

// ─── Writer interface ────────────────────────────────────────────────────────

export interface RendererWriter {
  write(text: string): void;
}

// ─── Pure formatting functions ───────────────────────────────────────────────
// These are exported for snapshot testing.

/**
 * Format the session header line.
 */
export function formatSessionHeader(prompt: string): string {
  // Truncate very long prompts for the header
  const maxLen = 80;
  const display =
    prompt.length > maxLen ? prompt.slice(0, maxLen) + "..." : prompt;
  return `[session] ${display}`;
}

/**
 * Format an agent start line.
 */
export function formatAgentStart(treePrefix: string, name: string): string {
  return `${BASE_INDENT}${treePrefix}[agent] ${name}`;
}

/**
 * Format a tool call line.
 */
export function formatToolLine(treePrefix: string, label: string): string {
  return `${BASE_INDENT}${treePrefix}[tool] ${label}`;
}

/**
 * Format a tool call line with a spinner placeholder.
 */
export function formatToolSpinner(treePrefix: string, label: string): string {
  return `${BASE_INDENT}${treePrefix}{spin} [tool] ${label}`;
}

/**
 * Format a warning line.
 */
export function formatWarn(treePrefix: string, message: string): string {
  return `${BASE_INDENT}${treePrefix}[warn] ${message}`;
}

/**
 * Format a feedback-received line.
 */
export function formatFeedback(message: string): string {
  return `\n${BASE_INDENT}[feedback] ${message}\n`;
}

/**
 * Format an error line (shown as tool output).
 */
export function formatError(continuation: string, message: string): string {
  return `${BASE_INDENT}${continuation}${OUTPUT_INDENT}[error] ${message}`;
}

/**
 * Format a tool output line.
 */
export function formatOutput(continuation: string, text: string): string {
  return `${BASE_INDENT}${continuation}${OUTPUT_INDENT}${text}`;
}

/**
 * Format the session end line.
 */
export function formatSessionEnd(
  status: "complete" | "incomplete",
  iterations: number
): string {
  return `${status}, ${iterations} ${iterations === 1 ? "iteration" : "iterations"}`;
}

/** Maximum number of text lines to show before truncating. */
const MAX_TEXT_LINES = 5;

/** Indent used for text continuation lines (aligns with text after "[text] "). */
const TEXT_CONT_INDENT = "       ";

/**
 * Format assistant text lines. Returns an array of formatted lines.
 * First line gets the [text] tag; subsequent lines are continuation-indented.
 * Truncates after MAX_TEXT_LINES.
 */
export function formatTextLines(text: string): string[] {
  const lines = text.split("\n");
  const result: string[] = [];

  const display = lines.slice(0, MAX_TEXT_LINES);
  for (let i = 0; i < display.length; i++) {
    if (i === 0) {
      result.push(`${BASE_INDENT}[text] ${display[i]}`);
    } else {
      result.push(`${BASE_INDENT}${TEXT_CONT_INDENT}${display[i]}`);
    }
  }

  if (lines.length > MAX_TEXT_LINES) {
    result.push(
      `${BASE_INDENT}${TEXT_CONT_INDENT}... ${lines.length - MAX_TEXT_LINES} more lines`
    );
  }

  return result;
}

// ─── Renderer class ──────────────────────────────────────────────────────────

export interface RendererOptions {
  /** Where to write output. Defaults to process.stdout. */
  writer?: RendererWriter;
  /** Override TTY detection for the spinner. */
  isTTY?: boolean;
}

/**
 * The tree renderer. Receives RenderEvents and produces formatted output.
 *
 * Can also be fed raw JSONL chunks via feedChunk() which handles parsing
 * and event conversion internally.
 */
export class TreeRenderer {
  private writer: RendererWriter;
  private tree: TreeState;
  private spinner: Spinner;
  private lineBuffer: LineBuffer;

  /** Whether we're inside an agent block (tools are nested). */
  private inAgent = false;
  /** Whether we've opened a tool-level tree inside the current agent. */
  private inToolTree = false;
  /** Track how many agents we've seen to know first/middle/last. */
  private agentCount = 0;
  /** Stack of agent session IDs for nesting. */
  private agentStack: string[] = [];
  /** The call ID of the currently active (spinning) tool. */
  private activeToolCallId: string | null = null;
  /** The label of the currently active tool (for final static line). */
  private activeToolLabel: string | null = null;
  /** The tree prefix used for the currently active tool. */
  private activeToolPrefix: string | null = null;
  /** Count of tools in the current agent block. */
  private toolCount = 0;
  /** Whether we auto-opened a top-level tool tree (no agent context). */
  private syntheticToolTree = false;

  constructor(opts?: RendererOptions) {
    this.writer = opts?.writer ?? process.stdout;
    this.tree = new TreeState();
    this.spinner = new Spinner(this.writer, { isTTY: opts?.isTTY });
    this.lineBuffer = new LineBuffer();
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Process a single RenderEvent and write formatted output.
   */
  onEvent(event: RenderEvent): void {
    switch (event.type) {
      case "session_start":
        this.handleSessionStart(event.prompt);
        break;
      case "agent_start":
        this.handleAgentStart(event.name, event.sessionId);
        break;
      case "agent_end":
        this.handleAgentEnd(event.sessionId);
        break;
      case "tool_start":
        this.handleToolStart(event.tool, event.title, event.callId);
        break;
      case "tool_end":
        this.handleToolEnd(event.callId, event.output, event.error, event.tool);
        break;
      case "text_content":
        this.handleText(event.text);
        break;
      case "warn":
        this.handleWarn(event.message);
        break;
      case "feedback_received":
        this.handleFeedback(event.feedback);
        break;
      case "session_end":
        this.handleSessionEnd(event.status, event.iterations);
        break;
    }
  }

  /**
   * Feed a raw chunk from the opencode subprocess stdout.
   * Handles JSONL line splitting, parsing, and event dispatch.
   */
  feedChunk(chunk: string): void {
    const lines = this.lineBuffer.push(chunk);
    for (const line of lines) {
      this.processLine(line);
    }
  }

  /**
   * Flush any remaining buffered data (call at end of stream).
   */
  flush(): void {
    const remaining = this.lineBuffer.flush();
    if (remaining) {
      this.processLine(remaining);
    }
    this.spinner.stop();
  }

  /**
   * Clean up resources (stop spinner, close any open branches).
   */
  cleanup(): void {
    this.spinner.stop();
    this.tree.reset();
  }

  // ─── Event handlers ─────────────────────────────────────────────────────

  private handleSessionStart(prompt: string): void {
    this.writeln(formatSessionHeader(prompt));
    this.writeln("");
  }

  private handleAgentStart(name: string, sessionId: string): void {
    // Close any open tool tree from a previous agent
    if (this.inToolTree) {
      this.tree.close();
      this.inToolTree = false;
    }

    // Close synthetic top-level tool tree if one was auto-opened
    if (this.syntheticToolTree) {
      this.tree.close();
      this.syntheticToolTree = false;
    }

    // Open agent-level tree on first agent
    if (this.agentStack.length === 0) {
      this.tree.open();
    }

    this.agentStack.push(sessionId);
    this.agentCount++;
    this.toolCount = 0;

    // We don't know if this is the last agent yet, so use false.
    // The prefix will be ╭─ for the first, ├─ for subsequent.
    const prefix = this.tree.prefix(false);
    this.writeln(formatAgentStart(prefix, name));

    // Open a nested level for tools within this agent
    this.tree.open();
    this.inToolTree = true;
    this.inAgent = true;
  }

  private handleAgentEnd(sessionId: string): void {
    // Close the tool-level tree
    if (this.inToolTree) {
      this.tree.close();
      this.inToolTree = false;
    }

    // Pop the agent from the stack
    const idx = this.agentStack.indexOf(sessionId);
    if (idx !== -1) {
      this.agentStack.splice(idx, 1);
    }

    this.inAgent = false;

    // Add a blank rail line between agents for visual breathing room
    if (this.agentStack.length === 0 && this.tree.depth > 0) {
      this.writeln(BASE_INDENT + this.tree.blankLine());
    }
  }

  private handleToolStart(tool: string, title: string, callId: string): void {
    // If tools arrive without agent context, auto-open a top-level tree
    if (!this.inAgent && !this.syntheticToolTree) {
      this.tree.open();
      this.syntheticToolTree = true;
    }

    this.toolCount++;

    // Stop any existing spinner and emit the previous tool's static line
    if (this.activeToolCallId) {
      if (this.activeToolPrefix && this.activeToolLabel) {
        this.spinner.stop(formatToolLine(this.activeToolPrefix, this.activeToolLabel));
      } else {
        this.spinner.stop();
      }
      this.activeToolCallId = null;
      this.activeToolLabel = null;
      this.activeToolPrefix = null;
    }

    // We don't know if this tool is last yet, so use false
    const prefix = this.tree.prefix(false);
    const spinnerText = formatToolSpinner(prefix, title);

    this.activeToolCallId = callId;
    this.activeToolLabel = title;
    this.activeToolPrefix = prefix;
    this.spinner.start(spinnerText);
  }

  private handleToolEnd(
    callId: string,
    output?: string,
    error?: string,
    tool?: string
  ): void {
    // Stop spinner and emit the final static tool line
    if (this.activeToolCallId === callId) {
      if (this.activeToolPrefix && this.activeToolLabel) {
        this.spinner.stop(formatToolLine(this.activeToolPrefix, this.activeToolLabel));
      } else {
        this.spinner.stop();
      }
      this.activeToolCallId = null;
      this.activeToolLabel = null;
      this.activeToolPrefix = null;
    }

    // Show error output if present
    if (error) {
      const cont = this.tree.continuation();
      this.writeln(formatError(cont, error));
    }

    // Suppress output for read-heavy tools that dump verbose content.
    // Only show output for tools where it's meaningful (bash, write, edit).
    const SUPPRESS_OUTPUT_TOOLS = new Set(["read", "grep", "glob", "task", "todowrite"]);
    const shouldShowOutput = !tool || !SUPPRESS_OUTPUT_TOOLS.has(tool);

    // Show truncated output if present and useful
    if (output && !error && shouldShowOutput) {
      const trimmed = output.trim();
      if (trimmed) {
        const lines = trimmed.split("\n");
        const cont = this.tree.continuation();
        // Show up to 5 lines of output
        const maxLines = 5;
        const display = lines.slice(0, maxLines);
        for (const line of display) {
          this.writeln(formatOutput(cont, line));
        }
        if (lines.length > maxLines) {
          this.writeln(
            formatOutput(cont, `... ${lines.length - maxLines} more lines`)
          );
        }
      }
    }
  }

  private handleWarn(message: string): void {
    const prefix = this.tree.prefix(false);
    this.writeln(formatWarn(prefix, message));
  }

  private handleFeedback(feedback: string): void {
    // Feedback renders outside the tree structure, similar to text
    this.writer.write(formatFeedback(feedback));
  }

  private handleText(text: string): void {
    // Skip empty text
    if (!text.trim()) return;

    // Stop any active spinner
    if (this.activeToolCallId) {
      if (this.activeToolPrefix && this.activeToolLabel) {
        this.spinner.stop(formatToolLine(this.activeToolPrefix, this.activeToolLabel));
      } else {
        this.spinner.stop();
      }
      this.activeToolCallId = null;
      this.activeToolLabel = null;
      this.activeToolPrefix = null;
    }

    // Close any open tree structures — text renders at the base level,
    // outside agent/tool tree nesting.
    if (this.inToolTree) {
      this.tree.close();
      this.inToolTree = false;
    }
    if (this.syntheticToolTree) {
      this.tree.close();
      this.syntheticToolTree = false;
    }
    // Close agent-level tree if open (text appears between agent blocks)
    if (this.inAgent) {
      // Pop from agent stack — the agent's tool tree is already closed
      this.inAgent = false;
    }
    // Close the outer agent-level tree
    while (this.tree.depth > 0) {
      this.tree.close();
    }
    this.agentStack = [];

    // Render the text lines
    const lines = formatTextLines(text);
    for (const line of lines) {
      this.writeln(line);
    }
    this.writeln("");
  }

  private handleSessionEnd(
    status: "complete" | "incomplete",
    iterations: number
  ): void {
    // Close synthetic tool tree if still open
    if (this.syntheticToolTree) {
      this.tree.close();
      this.syntheticToolTree = false;
    }

    // Close all remaining open tree levels
    while (this.tree.depth > 0) {
      this.tree.close();
    }

    this.writeln("");
    this.writeln(formatSessionEnd(status, iterations));
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private processLine(line: string): void {
    const event = parseLine(line);
    if (!event) return;

    const renderEvents = toRenderEvents(event);
    for (const re of renderEvents) {
      this.onEvent(re);
    }
  }

  private writeln(text: string): void {
    this.writer.write(text + "\n");
  }
}
