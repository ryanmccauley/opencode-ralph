import type { RalphSessionState } from "./runtime.js";

export function parseIterationLimit(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function formatRunStatus(state: RalphSessionState): string {
  if (!state.run) {
    return `Ralph idle. Default limit ${state.defaultMaxIterations}.`;
  }

  const run = state.run;
  const reason = run.waitReason ? ` (${run.waitReason})` : "";
  return `Ralph ${run.status} ${run.iteration}/${run.maxIterations}${reason}`;
}
