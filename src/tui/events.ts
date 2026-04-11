// ─── Render Events ────────────────────────────────────────────────────────────
// Internal event types consumed by the tree renderer.
// The JSON parser converts OpenCode JSONL into these events.

export interface SessionStart {
  type: "session_start";
  prompt: string;
}

export interface AgentStart {
  type: "agent_start";
  name: string;
  sessionId: string;
}

export interface AgentEnd {
  type: "agent_end";
  sessionId: string;
}

export interface ToolStart {
  type: "tool_start";
  tool: string;
  title: string;
  callId: string;
}

export interface ToolEnd {
  type: "tool_end";
  callId: string;
  /** The tool name, used for output suppression decisions. */
  tool?: string;
  output?: string;
  error?: string;
}

export interface TextContent {
  type: "text_content";
  text: string;
}

export interface Warn {
  type: "warn";
  message: string;
}

export interface SessionEnd {
  type: "session_end";
  iterations: number;
  status: "complete" | "incomplete";
}

export type RenderEvent =
  | SessionStart
  | AgentStart
  | AgentEnd
  | ToolStart
  | ToolEnd
  | TextContent
  | Warn
  | SessionEnd;
