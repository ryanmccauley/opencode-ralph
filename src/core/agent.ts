// ─── Agent File Generation ────────────────────────────────────────────────────
// Creates temporary agent .md files with provider-specific thinking config
// derived from the model's variant system.

import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const OC_AGENTS_DIR = join(homedir(), ".config", "opencode", "agents");

/** Find the ralph.md agent file relative to the binary/script */
function findAgentFile(): string {
  // Check next to the entry point first
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
  throw new Error(
    "Could not find ralph.md agent file. Place it next to the ralph binary."
  );
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

  const agentFile = findAgentFile();
  const body = extractAgentBody(agentFile);
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
