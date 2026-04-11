import { describe, test, expect } from "bun:test";
import {
  parseLine,
  toolLabel,
  toRenderEvents,
  LineBuffer,
  type OcToolUse,
} from "../tui/json-parser.js";

// ─── parseLine ───────────────────────────────────────────────────────────────

describe("parseLine", () => {
  test("parses valid JSON with type field", () => {
    const event = parseLine('{"type":"text","timestamp":123}');
    expect(event).not.toBeNull();
    expect(event!.type).toBe("text");
  });

  test("returns null for empty string", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("   ")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseLine("{broken")).toBeNull();
  });

  test("returns null for JSON without type field", () => {
    expect(parseLine('{"foo":"bar"}')).toBeNull();
  });

  test("returns null for non-object JSON", () => {
    expect(parseLine('"just a string"')).toBeNull();
    expect(parseLine("42")).toBeNull();
  });
});

// ─── toolLabel ───────────────────────────────────────────────────────────────

describe("toolLabel", () => {
  test("uses title when available", () => {
    const state = {
      status: "completed" as const,
      input: {},
      title: "Search for errors",
    };
    expect(toolLabel("grep", state)).toBe("grep: Search for errors");
  });

  test("bash: uses description from input", () => {
    const state = {
      status: "completed" as const,
      input: { description: "Run test suite", command: "bun test" },
    };
    expect(toolLabel("bash", state)).toBe("bash: Run test suite");
  });

  test("bash: falls back to command when no description", () => {
    const state = {
      status: "completed" as const,
      input: { command: "bun test" },
    };
    expect(toolLabel("bash", state)).toBe("bash: bun test");
  });

  test("bash: truncates long commands", () => {
    const longCmd = "a".repeat(100);
    const state = {
      status: "completed" as const,
      input: { command: longCmd },
    };
    const label = toolLabel("bash", state);
    expect(label.length).toBeLessThanOrEqual(66); // "bash: " + 60 chars
  });

  test("read: shows file path", () => {
    const state = {
      status: "completed" as const,
      input: { filePath: "src/core/runner.ts" },
    };
    expect(toolLabel("read", state)).toBe("read: src/core/runner.ts");
  });

  test("write: shows file path", () => {
    const state = {
      status: "completed" as const,
      input: { filePath: "src/tui/renderer.ts" },
    };
    expect(toolLabel("write", state)).toBe("write: src/tui/renderer.ts");
  });

  test("grep: shows pattern", () => {
    const state = {
      status: "completed" as const,
      input: { pattern: "handleError" },
    };
    expect(toolLabel("grep", state)).toBe('grep: "handleError"');
  });

  test("glob: shows pattern", () => {
    const state = {
      status: "completed" as const,
      input: { pattern: "**/*.ts" },
    };
    expect(toolLabel("glob", state)).toBe("glob: **/*.ts");
  });

  test("task: shows description", () => {
    const state = {
      status: "completed" as const,
      input: { description: "Search codebase" },
    };
    expect(toolLabel("task", state)).toBe("task: Search codebase");
  });

  test("unknown tool: returns just the tool name", () => {
    const state = {
      status: "completed" as const,
      input: {},
    };
    expect(toolLabel("custom_tool", state)).toBe("custom_tool");
  });
});

// ─── toRenderEvents ──────────────────────────────────────────────────────────

describe("toRenderEvents", () => {
  test("text events produce text_content render event", () => {
    const events = toRenderEvents({
      type: "text",
      timestamp: 123,
      sessionID: "ses_123",
      part: { id: "p1", type: "text", text: "Hello world" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("text_content");
    if (events[0].type === "text_content") {
      expect(events[0].text).toBe("Hello world");
    }
  });

  test("text event strips DONE token", () => {
    const events = toRenderEvents({
      type: "text",
      timestamp: 123,
      sessionID: "ses_123",
      part: { id: "p1", type: "text", text: "All done!\n\n<ralph>DONE</ralph>" },
    });
    expect(events).toHaveLength(1);
    if (events[0].type === "text_content") {
      expect(events[0].text).toBe("All done!");
      expect(events[0].text).not.toContain("<ralph>");
    }
  });

  test("text event with only DONE token produces no render event", () => {
    const events = toRenderEvents({
      type: "text",
      timestamp: 123,
      sessionID: "ses_123",
      part: { id: "p1", type: "text", text: "<ralph>DONE</ralph>" },
    });
    expect(events).toEqual([]);
  });

  test("step_start produces no render events", () => {
    const events = toRenderEvents({
      type: "step_start",
      timestamp: 123,
      sessionID: "ses_123",
      part: {
        id: "p1",
        sessionID: "ses_123",
        messageID: "msg_1",
        type: "step-start",
      },
    });
    expect(events).toEqual([]);
  });

  test("step_finish produces no render events", () => {
    const events = toRenderEvents({
      type: "step_finish",
      timestamp: 123,
      sessionID: "ses_123",
      part: {
        id: "p1",
        sessionID: "ses_123",
        messageID: "msg_1",
        type: "step-finish",
        reason: "stop",
      },
    });
    expect(events).toEqual([]);
  });

  test("tool_use produces ToolStart + ToolEnd", () => {
    const ocEvent: OcToolUse = {
      type: "tool_use",
      timestamp: 123,
      sessionID: "ses_123",
      part: {
        id: "p1",
        sessionID: "ses_123",
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "src/index.ts" },
          output: "file contents",
          title: "src/index.ts",
        },
      },
    };

    const events = toRenderEvents(ocEvent);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("tool_start");
    expect(events[1].type).toBe("tool_end");
  });

  test("tool_use passes tool name through to ToolEnd", () => {
    const ocEvent: OcToolUse = {
      type: "tool_use",
      timestamp: 123,
      sessionID: "ses_123",
      part: {
        id: "p1",
        sessionID: "ses_123",
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "src/index.ts" },
          output: "file contents",
          title: "src/index.ts",
        },
      },
    };

    const events = toRenderEvents(ocEvent);
    expect(events[1].type).toBe("tool_end");
    if (events[1].type === "tool_end") {
      expect(events[1].tool).toBe("read");
    }
  });

  test("tool_use with non-zero exit produces error", () => {
    const ocEvent: OcToolUse = {
      type: "tool_use",
      timestamp: 123,
      sessionID: "ses_123",
      part: {
        id: "p1",
        sessionID: "ses_123",
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "bun build" },
          output: "error output",
          metadata: { exit: 1 },
        },
      },
    };

    const events = toRenderEvents(ocEvent);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe("tool_end");
    if (events[1].type === "tool_end") {
      expect(events[1].error).toBe("exit code 1");
    }
  });

  test("task tool produces agent_start + agent_end", () => {
    const ocEvent: OcToolUse = {
      type: "tool_use",
      timestamp: 123,
      sessionID: "ses_123",
      part: {
        id: "p1",
        sessionID: "ses_123",
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "task",
        state: {
          status: "completed",
          input: {
            subagent_type: "explore",
            description: "Search codebase",
          },
        },
      },
    };

    const events = toRenderEvents(ocEvent);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("agent_start");
    expect(events[1].type).toBe("agent_end");
    if (events[0].type === "agent_start") {
      expect(events[0].name).toBe("explore");
    }
  });

  test("error event produces warn", () => {
    const events = toRenderEvents({
      type: "error",
      timestamp: 123,
      error: {
        name: "APIError",
        data: { message: "Rate limit exceeded" },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("warn");
    if (events[0].type === "warn") {
      expect(events[0].message).toBe("Rate limit exceeded");
    }
  });
});

// ─── LineBuffer ──────────────────────────────────────────────────────────────

describe("LineBuffer", () => {
  test("splits complete lines", () => {
    const buf = new LineBuffer();
    const lines = buf.push('{"type":"text"}\n{"type":"tool_use"}\n');
    expect(lines).toEqual(['{"type":"text"}', '{"type":"tool_use"}']);
  });

  test("buffers partial lines across chunks", () => {
    const buf = new LineBuffer();

    const first = buf.push('{"type":"te');
    expect(first).toEqual([]);

    const second = buf.push('xt"}\n');
    expect(second).toEqual(['{"type":"text"}']);
  });

  test("flush returns remaining partial data", () => {
    const buf = new LineBuffer();
    buf.push('{"type":"text"}');

    const remaining = buf.flush();
    expect(remaining).toBe('{"type":"text"}');
  });

  test("flush returns null when empty", () => {
    const buf = new LineBuffer();
    expect(buf.flush()).toBeNull();
  });

  test("handles empty lines", () => {
    const buf = new LineBuffer();
    const lines = buf.push('\n\n{"type":"text"}\n');
    expect(lines).toEqual(["", "", '{"type":"text"}']);
  });
});
