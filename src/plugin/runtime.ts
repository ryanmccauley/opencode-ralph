export type RalphRunStatus =
  | "running"
  | "paused"
  | "complete"
  | "max_reached"
  | "error";

export type RalphPauseReason =
  | "none"
  | "manual"
  | "user_abort"
  | "agent_wait"
  | "max_reached"
  | "error";

export interface RalphRunState {
  id: string;
  status: RalphRunStatus;
  pauseReason: RalphPauseReason;
  iteration: number;
  maxIterations: number;
  activePromptMessageID: string;
  lastUserMessageID: string;
  lastAssistantMessageID?: string;
  lastEvaluatedAssistantMessageID?: string;
  syntheticMessageIDs: string[];
  sawCompletion: boolean;
  waitReason?: string;
  startedAt: number;
  updatedAt: number;
}

export interface RalphSessionState {
  sessionID: string;
  defaultMaxIterations: number;
  run?: RalphRunState;
  updatedAt: number;
}

export function createSessionState(
  sessionID: string,
  defaultMaxIterations: number
): RalphSessionState {
  return {
    sessionID,
    defaultMaxIterations,
    updatedAt: Date.now(),
  };
}

export function createRunState(
  messageID: string,
  maxIterations: number
): RalphRunState {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    status: "running",
    pauseReason: "none",
    iteration: 1,
    maxIterations,
    activePromptMessageID: messageID,
    lastUserMessageID: messageID,
    syntheticMessageIDs: [],
    sawCompletion: false,
    startedAt: now,
    updatedAt: now,
  };
}

export function shouldEvaluateIdle(run: RalphRunState | undefined): boolean {
  if (!run) return false;
  if (run.status !== "running") return false;
  if (!run.lastAssistantMessageID) return false;
  return run.lastAssistantMessageID !== run.lastEvaluatedAssistantMessageID;
}

export function shouldAutoContinue(run: RalphRunState | undefined): boolean {
  if (!run) return false;
  if (run.status !== "running") return false;
  if (run.sawCompletion) return false;
  return run.iteration < run.maxIterations;
}

export function createSyntheticMessageID(): string {
  return `ralph-${crypto.randomUUID()}`;
}
