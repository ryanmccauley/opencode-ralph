// ─── Agent File Generation ────────────────────────────────────────────────────
// Creates temporary agent .md files with provider-specific thinking config
// derived from the model's variant system.
//
// When a variant config is needed, the *full* frontmatter from ralph.md is
// read and the variant keys are merged in, so changes to permissions,
// temperature, etc. in ralph.md are always honoured.

import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const OC_AGENTS_DIR = join(homedir(), ".config", "opencode", "agents");

// ─── Embedded default agent content ──────────────────────────────────────────
// Used when ralph.md isn't on disk (e.g. compiled binary).

const DEFAULT_FRONTMATTER: Record<string, unknown> = {
  description: "Autonomous agent that works until the task is fully complete",
  mode: "primary",
  temperature: 0.7,
  color: "#FFFFFF",
  permission: {
    edit: "allow",
    bash: { "*": "allow" },
    webfetch: "allow",
  },
};

const DEFAULT_BODY = `
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

// ─── File discovery ──────────────────────────────────────────────────────────

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

/**
 * Parse ralph.md into its frontmatter key-values and markdown body.
 * The frontmatter is returned as raw YAML text (between the --- markers).
 */
function parseAgentFile(path: string): { frontmatterText: string; body: string } {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  let separators = 0;
  const fmLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (/^---\s*$/.test(line)) {
      separators++;
      continue;
    }
    if (separators < 2) {
      fmLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }
  return {
    frontmatterText: fmLines.join("\n"),
    body: bodyLines.join("\n"),
  };
}

// ─── YAML helpers ────────────────────────────────────────────────────────────

/**
 * Serialize a value to YAML string at the given indentation level.
 * Handles nested objects, arrays, strings, numbers, booleans, and null.
 */
export function toYaml(value: unknown, indent: number = 0): string {
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

// ─── Agent installation ─────────────────────────────────────────────────────

/**
 * Ensure ralph.md is installed in the opencode agents directory.
 * Reads from the external file if found, otherwise uses embedded defaults.
 * This is idempotent — safe to call multiple times.
 */
function ensureAgentInstalled(): void {
  const targetPath = join(OC_AGENTS_DIR, "ralph.md");

  const externalFile = findAgentFile();
  let content: string;

  if (externalFile) {
    content = readFileSync(externalFile, "utf-8");
  } else {
    const frontmatter = toYaml(DEFAULT_FRONTMATTER, 0);
    content = `---\n${frontmatter}\n---\n${DEFAULT_BODY}`;
  }

  mkdirSync(OC_AGENTS_DIR, { recursive: true });
  writeFileSync(targetPath, content, "utf-8");
}

export interface AgentSetup {
  agentName: string;
  tmpFile: string | null;
}

/**
 * Set up the agent for a run.
 * Always installs ralph.md into the opencode agents directory so opencode
 * can find it. If variantConfig is provided, also creates a temp agent file
 * with the variant config merged into the frontmatter.
 */
export function setupAgent(
  variantConfig: Record<string, unknown> | null
): AgentSetup {
  // Always ensure the base agent file is installed
  ensureAgentInstalled();

  if (!variantConfig) {
    return { agentName: "ralph", tmpFile: null };
  }

  // Read the real agent file (or fall back to defaults)
  let frontmatterText: string;
  let body: string;
  const externalFile = findAgentFile();

  if (externalFile) {
    const parsed = parseAgentFile(externalFile);
    frontmatterText = parsed.frontmatterText;
    body = parsed.body;
  } else {
    // No file on disk -- build frontmatter from embedded defaults
    frontmatterText = toYaml(DEFAULT_FRONTMATTER, 0);
    body = DEFAULT_BODY;
  }

  // Merge variant config: append variant YAML after the existing frontmatter
  const variantYaml = toYaml(variantConfig, 0);

  const tmpName = `ralph-tmp-${process.pid}`;
  mkdirSync(OC_AGENTS_DIR, { recursive: true });
  const tmpPath = join(OC_AGENTS_DIR, `${tmpName}.md`);

  const content = `---\n${frontmatterText}\n${variantYaml}\n---\n${body}`;
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
