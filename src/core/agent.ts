// ─── Agent File Generation ────────────────────────────────────────────────────
// Creates temporary agent .md files with provider-specific thinking config
// derived from the model's variant system.

import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const OC_AGENTS_DIR = join(homedir(), ".config", "opencode", "agents");

// ─── Embedded default agent body ──────────────────────────────────────────────
// This is the content of ralph.md (after the frontmatter) compiled into the
// binary so the tool works even when ralph.md isn't on disk.  An external
// ralph.md file, if found, will override this default.
const DEFAULT_AGENT_BODY = `
You are a fully autonomous coding agent.

## Autonomy Rules (CRITICAL)

- Work autonomously. Do NOT stop to ask for user confirmation or feedback.
- Do NOT pause to summarize progress or ask "should I continue?" or "would you like me to proceed?"
- After completing one step, IMMEDIATELY move to the next.
- Keep working in a loop until the specified outcome is fully achieved.
- Only stop when the task is COMPLETE or you are genuinely stuck on something that requires human input.
- If you encounter an error, attempt to fix it yourself before asking for help.
- Re-verify your work after making changes. Run tests, builds, or whatever is appropriate to confirm the fix.
- When the task is fully complete and verified, you MUST output \`<ralph>DONE</ralph>\` as the very last line of your final message. This signals that you are finished. Do NOT output this token until the task is truly done.`;

/** Try to find an external ralph.md agent file; returns null if not found */
function findAgentFile(): string | null {
  const scriptDir = dirname(Bun.main);
  const candidates = [
    join(scriptDir, "ralph.md"),
    join(scriptDir, "..", "ralph.md"),
    join(process.cwd(), "ralph.md"),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c, "utf-8");
      return c;
    } catch {
      continue;
    }
  }
  return null;
}

/** Extract the markdown body from ralph.md (everything after the second ---) */
function extractAgentBody(agentFile: string): string {
  const content = readFileSync(agentFile, "utf-8");
  const lines = content.split("\n");
  let separators = 0;
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (/^---\s*$/.test(line)) {
      separators++;
      continue;
    }
    if (separators >= 2) {
      bodyLines.push(line);
    }
  }
  return bodyLines.join("\n");
}

/**
 * Get the agent body text: use an external ralph.md if available,
 * otherwise fall back to the embedded default.
 */
function getAgentBody(): string {
  const externalFile = findAgentFile();
  if (externalFile) {
    return extractAgentBody(externalFile);
  }
  return DEFAULT_AGENT_BODY;
}

/**
 * Serialize a value to YAML string at the given indentation level.
 * Handles nested objects, arrays, strings, numbers, booleans, and null.
 * No external YAML dependency needed.
 */
function toYaml(value: unknown, indent: number = 0): string {
  const prefix = "  ".repeat(indent);

  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    // Quote strings that could be misinterpreted
    if (
      value === "" ||
      value === "true" ||
      value === "false" ||
      value === "null" ||
      /^[\d]/.test(value) ||
      /[:#{}[\],&*?|>!'"%@`]/.test(value) ||
      value.includes("\n")
    ) {
      return JSON.stringify(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => {
      const serialized = toYaml(item, indent + 1);
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        // Object items: put first key on same line as dash
        return `${prefix}- ${serialized.trimStart()}`;
      }
      return `${prefix}- ${serialized}`;
    });
    return "\n" + items.join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([key, val]) => {
      const serializedVal = toYaml(val, indent + 1);
      if (typeof val === "object" && val !== null && !Array.isArray(val) && Object.keys(val).length > 0) {
        return `${prefix}${key}:\n${serializedVal}`;
      }
      if (Array.isArray(val) && val.length > 0) {
        return `${prefix}${key}:${serializedVal}`;
      }
      return `${prefix}${key}: ${serializedVal}`;
    });
    return lines.join("\n");
  }

  return String(value);
}

export interface AgentSetup {
  agentName: string;
  tmpFile: string | null;
}

/**
 * Set up the agent for a run.
 * If variantConfig is provided, creates a temp agent file with that config
 * merged into the frontmatter. Returns the agent name and path to any
 * temp file (for cleanup).
 */
export function setupAgent(
  variantConfig: Record<string, unknown> | null
): AgentSetup {
  if (!variantConfig) {
    return { agentName: "ralph", tmpFile: null };
  }

  const body = getAgentBody();
  const tmpName = `ralph-tmp-${process.pid}`;

  mkdirSync(OC_AGENTS_DIR, { recursive: true });
  const tmpPath = join(OC_AGENTS_DIR, `${tmpName}.md`);

  // Serialize the variant config as top-level YAML keys
  const variantYaml = toYaml(variantConfig, 0);

  const content = `---
description: Autonomous agent that works until the task is fully complete
mode: primary
temperature: 0.7
color: "#FFFFFF"
${variantYaml}
permission:
  edit: allow
  bash:
    "*": allow
  webfetch: allow
---
${body}`;

  writeFileSync(tmpPath, content, "utf-8");

  return { agentName: tmpName, tmpFile: tmpPath };
}

/** Clean up a temporary agent file */
export function cleanupAgent(setup: AgentSetup): void {
  if (setup.tmpFile) {
    try {
      unlinkSync(setup.tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
