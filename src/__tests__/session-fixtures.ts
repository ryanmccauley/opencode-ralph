import type { SessionMeta } from "../types.js";

const DEFAULT_SESSION_FIXTURE: SessionMeta = {
  timestamp: "2026-04-08_143022_a7x3",
  model: "openai/gpt-4o",
  thinking: "off",
  maxIter: 50,
  prompt: "Fix all failing tests",
  status: "incomplete",
  iterations: 0,
};

/**
 * Test-only fixture factory for session metadata.
 * Keeps data setup deterministic and centralized across suites.
 */
export function buildSessionMeta(
  overrides: Partial<SessionMeta> = {}
): SessionMeta {
  return {
    ...DEFAULT_SESSION_FIXTURE,
    ...overrides,
  };
}
