import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  createSessionState,
  type RalphSessionState,
} from "./runtime.js";

interface RalphStoreData {
  version: 1;
  sessions: Record<string, RalphSessionState>;
}

const EMPTY_STATE: RalphStoreData = {
  version: 1,
  sessions: {},
};

export class RalphStateStore {
  private cache: RalphStoreData;

  constructor(
    private readonly filePath: string,
    private readonly defaultMaxIterations: number
  ) {
    this.cache = this.load();
  }

  get(sessionID: string): RalphSessionState {
    const existing = this.cache.sessions[sessionID];
    if (existing) return existing;

    const created = createSessionState(sessionID, this.defaultMaxIterations);
    this.cache.sessions[sessionID] = created;
    this.save();
    return created;
  }

  update(
    sessionID: string,
    updater: (state: RalphSessionState) => RalphSessionState
  ): RalphSessionState {
    const current = this.get(sessionID);
    const next = updater(structuredClone(current));
    next.updatedAt = Date.now();
    this.cache.sessions[sessionID] = next;
    this.save();
    return next;
  }

  private load(): RalphStoreData {
    if (!existsSync(this.filePath)) {
      return structuredClone(EMPTY_STATE);
    }

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<RalphStoreData>;
      return {
        version: 1,
        sessions: parsed.sessions ?? {},
      };
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
  }
}
