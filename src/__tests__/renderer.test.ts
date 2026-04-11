import { describe, test, expect } from "bun:test";
import {
  TreeRenderer,
  formatSessionHeader,
  formatAgentStart,
  formatToolLine,
  formatWarn,
  formatError,
  formatOutput,
  formatSessionEnd,
  formatTextLines,
} from "../tui/renderer.js";
import { Spinner } from "../tui/spinner.js";
import type { RenderEvent } from "../tui/events.js";

// ─── Helper: capture renderer output ────────────────────────────────────────

function createCapture() {
  const lines: string[] = [];
  const writer = {
    write(text: string) {
      // Strip ANSI control sequences for clean test comparison
      // \r\x1b[2K is the spinner's line-clear sequence
      const cleaned = text.replace(/\r\x1b\[2K/g, "");
      if (cleaned) {
        lines.push(cleaned);
      }
    },
  };
  return { lines, writer };
}

function renderEvents(events: RenderEvent[]): string[] {
  const { lines, writer } = createCapture();
  const renderer = new TreeRenderer({ writer });
  for (const event of events) {
    renderer.onEvent(event);
  }
  renderer.cleanup();
  return lines;
}

// ─── Pure formatting functions ───────────────────────────────────────────────

describe("formatting functions", () => {
  test("formatSessionHeader", () => {
    expect(formatSessionHeader("Fix all tests")).toBe(
      "[session] Fix all tests"
    );
  });

  test("formatSessionHeader truncates long prompts", () => {
    const long = "a".repeat(100);
    const result = formatSessionHeader(long);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(100);
  });

  test("formatAgentStart", () => {
    expect(formatAgentStart("╭─ ", "explore")).toBe(
      "  ╭─ [agent] explore"
    );
  });

  test("formatToolLine", () => {
    expect(formatToolLine("│  ╭─ ", "grep: handleError")).toBe(
      "  │  ╭─ [tool] grep: handleError"
    );
  });

  test("formatWarn", () => {
    expect(formatWarn("│  ├─ ", "something went wrong")).toBe(
      "  │  ├─ [warn] something went wrong"
    );
  });

  test("formatError", () => {
    expect(formatError("│  ", "exit code 1")).toBe(
      "  │     [error] exit code 1"
    );
  });

  test("formatOutput", () => {
    expect(formatOutput("│  ", "126 passed")).toBe("  │     126 passed");
  });

  test("formatSessionEnd complete", () => {
    expect(formatSessionEnd("complete", 3)).toBe("complete, 3 iterations");
  });

  test("formatSessionEnd singular", () => {
    expect(formatSessionEnd("complete", 1)).toBe("complete, 1 iteration");
  });

  test("formatSessionEnd incomplete", () => {
    expect(formatSessionEnd("incomplete", 50)).toBe(
      "incomplete, 50 iterations"
    );
  });
});

// ─── Renderer integration ────────────────────────────────────────────────────

describe("TreeRenderer", () => {
  test("session start emits header", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Fix all tests" },
    ]);

    expect(output[0]).toBe("[session] Fix all tests\n");
    expect(output[1]).toBe("\n"); // blank line after header
  });

  test("session end emits summary", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Fix tests" },
      { type: "session_end", iterations: 3, status: "complete" },
    ]);

    // Find the session end line
    const endLine = output.find((l) => l.includes("complete, 3 iterations"));
    expect(endLine).toBeDefined();
  });

  test("agent start + end renders tree structure", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Fix tests" },
      { type: "agent_start", name: "explore", sessionId: "s1" },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const agentLine = output.find((l) => l.includes("[agent] explore"));
    expect(agentLine).toBeDefined();
    expect(agentLine).toContain("╭─");
  });

  test("tool events render inside agent tree", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Fix tests" },
      { type: "agent_start", name: "explore", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "grep",
        title: 'grep: "handleError"',
        callId: "c1",
      },
      { type: "tool_end", callId: "c1" },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const toolLine = output.find((l) => l.includes("[tool]"));
    expect(toolLine).toBeDefined();
  });

  test("tool error renders error line", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Fix tests" },
      { type: "agent_start", name: "general", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "bash",
        title: "bash: Run tests",
        callId: "c1",
      },
      { type: "tool_end", callId: "c1", error: "exit code 1" },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "incomplete" },
    ]);

    const errorLine = output.find((l) => l.includes("[error] exit code 1"));
    expect(errorLine).toBeDefined();
  });

  test("tool output renders indented lines", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Fix tests" },
      { type: "agent_start", name: "general", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "bash",
        title: "bash: Run tests",
        callId: "c1",
      },
      { type: "tool_end", callId: "c1", output: "126 passed" },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const outputLine = output.find((l) => l.includes("126 passed"));
    expect(outputLine).toBeDefined();
  });

  test("warn renders with tag", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Fix tests" },
      { type: "agent_start", name: "review", sessionId: "s1" },
      { type: "warn", message: "missing edge case" },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const warnLine = output.find((l) =>
      l.includes("[warn] missing edge case")
    );
    expect(warnLine).toBeDefined();
  });

  test("multiple agents render with proper tree branching", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Refactor auth" },
      { type: "agent_start", name: "explore", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "grep",
        title: 'grep: "auth"',
        callId: "c1",
      },
      { type: "tool_end", callId: "c1" },
      { type: "agent_end", sessionId: "s1" },
      { type: "agent_start", name: "general", sessionId: "s2" },
      {
        type: "tool_start",
        tool: "write",
        title: "write: src/auth.ts",
        callId: "c2",
      },
      { type: "tool_end", callId: "c2" },
      { type: "agent_end", sessionId: "s2" },
      { type: "session_end", iterations: 2, status: "complete" },
    ]);

    // Should have both agents
    const exploreLine = output.find((l) => l.includes("[agent] explore"));
    const generalLine = output.find((l) => l.includes("[agent] general"));
    expect(exploreLine).toBeDefined();
    expect(generalLine).toBeDefined();
  });

  test("feedChunk processes JSONL", () => {
    const { lines, writer } = createCapture();
    const renderer = new TreeRenderer({ writer });

    renderer.onEvent({ type: "session_start", prompt: "Test" });

    // Feed a tool_use JSONL event
    const toolEvent = JSON.stringify({
      type: "tool_use",
      timestamp: 123,
      sessionID: "ses_1",
      part: {
        id: "p1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "src/index.ts" },
          title: "src/index.ts",
        },
      },
    });

    // Need an agent context for tools to render into
    renderer.onEvent({
      type: "agent_start",
      name: "explore",
      sessionId: "s1",
    });
    renderer.feedChunk(toolEvent + "\n");
    renderer.flush();
    renderer.cleanup();

    // Should have processed the event
    const hasToolLine = lines.some((l) => l.includes("[tool]"));
    expect(hasToolLine).toBe(true);
  });

  test("long tool output is truncated to 5 lines", () => {
    const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");

    const output = renderEvents([
      { type: "session_start", prompt: "Test" },
      { type: "agent_start", name: "general", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "bash",
        title: "bash: Run tests",
        callId: "c1",
      },
      { type: "tool_end", callId: "c1", output: longOutput },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const moreLines = output.find((l) => l.includes("... 15 more lines"));
    expect(moreLines).toBeDefined();
  });

  // ─── Tools without agent context ──────────────────────────────────────────

  test("tools render without agent context (synthetic tree)", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Quick fix" },
      {
        type: "tool_start",
        tool: "read",
        title: "read: src/index.ts",
        callId: "c1",
      },
      { type: "tool_end", callId: "c1" },
      {
        type: "tool_start",
        tool: "edit",
        title: "edit: src/index.ts",
        callId: "c2",
      },
      { type: "tool_end", callId: "c2" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    // Both tools should render
    const readLine = output.find((l) => l.includes("[tool] read: src/index.ts"));
    const editLine = output.find((l) => l.includes("[tool] edit: src/index.ts"));
    expect(readLine).toBeDefined();
    expect(editLine).toBeDefined();
  });

  test("tools without agent followed by agent start works", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Multi-step" },
      {
        type: "tool_start",
        tool: "read",
        title: "read: src/index.ts",
        callId: "c1",
      },
      { type: "tool_end", callId: "c1" },
      { type: "agent_start", name: "explore", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "grep",
        title: 'grep: "error"',
        callId: "c2",
      },
      { type: "tool_end", callId: "c2" },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    // Both the standalone tool and agent should render
    const readLine = output.find((l) => l.includes("[tool] read:"));
    const agentLine = output.find((l) => l.includes("[agent] explore"));
    expect(readLine).toBeDefined();
    expect(agentLine).toBeDefined();
  });

  // ─── Tool output suppression ──────────────────────────────────────────────

  test("read tool output is suppressed", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Test" },
      { type: "agent_start", name: "general", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "read",
        title: "read: src/index.ts",
        callId: "c1",
      },
      {
        type: "tool_end",
        callId: "c1",
        tool: "read",
        output: "const x = 1;\nconst y = 2;\nexport { x, y };",
      },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    // Output should not appear (read tool suppressed)
    const outputLine = output.find((l) => l.includes("const x"));
    expect(outputLine).toBeUndefined();
  });

  test("grep tool output is suppressed", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Test" },
      { type: "agent_start", name: "general", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "grep",
        title: 'grep: "error"',
        callId: "c1",
      },
      {
        type: "tool_end",
        callId: "c1",
        tool: "grep",
        output: "src/index.ts:5: error handling\nsrc/utils.ts:10: error log",
      },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const outputLine = output.find((l) => l.includes("error handling"));
    expect(outputLine).toBeUndefined();
  });

  test("bash tool output is NOT suppressed", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Test" },
      { type: "agent_start", name: "general", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "bash",
        title: "bash: Run tests",
        callId: "c1",
      },
      {
        type: "tool_end",
        callId: "c1",
        tool: "bash",
        output: "126 passed, 0 failed",
      },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const outputLine = output.find((l) => l.includes("126 passed"));
    expect(outputLine).toBeDefined();
  });

  test("tool_end without tool field shows output (backward compat)", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Test" },
      { type: "agent_start", name: "general", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "bash",
        title: "bash: Run tests",
        callId: "c1",
      },
      { type: "tool_end", callId: "c1", output: "all good" },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const outputLine = output.find((l) => l.includes("all good"));
    expect(outputLine).toBeDefined();
  });

  test("suppressed tool still shows errors", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Test" },
      { type: "agent_start", name: "general", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "read",
        title: "read: missing.ts",
        callId: "c1",
      },
      {
        type: "tool_end",
        callId: "c1",
        tool: "read",
        error: "file not found",
      },
      { type: "agent_end", sessionId: "s1" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    // Errors should still render even for suppressed tools
    const errorLine = output.find((l) => l.includes("[error] file not found"));
    expect(errorLine).toBeDefined();
  });
});

// ─── Spinner TTY detection ───────────────────────────────────────────────────

describe("Spinner TTY detection", () => {
  test("non-TTY spinner does not emit ANSI escape sequences", () => {
    const chunks: string[] = [];
    const writer = { write: (t: string) => chunks.push(t) };
    const spinner = new Spinner(writer, { isTTY: false });

    spinner.start("  ╭─ {spin} [tool] bash: test");
    // In non-TTY mode, start() should not emit anything (no draw call)
    expect(chunks.length).toBe(0);

    spinner.stop("  ╭─ [tool] bash: test");
    // stop() should emit the final text without ANSI
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe("  ╭─ [tool] bash: test\n");
    expect(chunks[0]).not.toContain("\x1b[2K");
    expect(chunks[0]).not.toContain("\r");
  });

  test("TTY spinner emits ANSI escape sequences", () => {
    const chunks: string[] = [];
    const writer = { write: (t: string) => chunks.push(t) };
    const spinner = new Spinner(writer, { isTTY: true });

    spinner.start("  ╭─ {spin} [tool] bash: test");
    // In TTY mode, start() calls draw() which emits ANSI
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toContain("\r\x1b[2K");

    spinner.stop("  ╭─ [tool] bash: test");
    // stop() should also use ANSI in TTY mode
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk).toContain("\r\x1b[2K");
  });
});

// ─── Text rendering ──────────────────────────────────────────────────────────

describe("formatTextLines", () => {
  test("formats single line with [text] tag", () => {
    const lines = formatTextLines("Hello world");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("  [text] Hello world");
  });

  test("formats multi-line with continuation indent", () => {
    const lines = formatTextLines("Line one\nLine two\nLine three");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("  [text] Line one");
    expect(lines[1]).toContain("Line two");
    // Continuation lines should not have [text] tag
    expect(lines[1]).not.toContain("[text]");
  });

  test("truncates after 5 lines", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join("\n");
    const lines = formatTextLines(text);
    // 5 display lines + 1 truncation line
    expect(lines).toHaveLength(6);
    expect(lines[5]).toContain("... 5 more lines");
  });
});

describe("TreeRenderer text rendering", () => {
  test("text-only session renders text between header and end", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "test" },
      { type: "text_content", text: "Hello! I'm here and ready to help." },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const textLine = output.find((l) => l.includes("[text]"));
    expect(textLine).toBeDefined();
    expect(textLine).toContain("Hello! I'm here and ready to help.");
  });

  test("text between agent groups renders correctly", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "Fix build" },
      { type: "text_content", text: "Let me investigate..." },
      { type: "agent_start", name: "explore", sessionId: "s1" },
      {
        type: "tool_start",
        tool: "grep",
        title: 'grep: "error"',
        callId: "c1",
      },
      { type: "tool_end", callId: "c1" },
      { type: "agent_end", sessionId: "s1" },
      { type: "text_content", text: "Found the issue. Fixing now..." },
      { type: "agent_start", name: "general", sessionId: "s2" },
      {
        type: "tool_start",
        tool: "edit",
        title: "edit: src/index.ts",
        callId: "c2",
      },
      { type: "tool_end", callId: "c2" },
      { type: "agent_end", sessionId: "s2" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    // Both text blocks should appear
    const textLines = output.filter((l) => l.includes("[text]"));
    expect(textLines).toHaveLength(2);
    expect(textLines[0]).toContain("Let me investigate");
    expect(textLines[1]).toContain("Found the issue");

    // Agents should still appear
    const agentLines = output.filter((l) => l.includes("[agent]"));
    expect(agentLines).toHaveLength(2);
  });

  test("long text is truncated in renderer", () => {
    const longText = Array.from({ length: 15 }, (_, i) => `Paragraph ${i + 1}`).join("\n");
    const output = renderEvents([
      { type: "session_start", prompt: "test" },
      { type: "text_content", text: longText },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const truncLine = output.find((l) => l.includes("... 10 more lines"));
    expect(truncLine).toBeDefined();
  });

  test("empty text is not rendered", () => {
    const output = renderEvents([
      { type: "session_start", prompt: "test" },
      { type: "text_content", text: "" },
      { type: "session_end", iterations: 1, status: "complete" },
    ]);

    const textLine = output.find((l) => l.includes("[text]"));
    expect(textLine).toBeUndefined();
  });
});
