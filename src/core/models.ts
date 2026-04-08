// ─── Model Discovery via OpenCode SDK ─────────────────────────────────────────
// Starts a temporary OpenCode server, queries provider.list(), builds model list.
// Results are cached to disk (~/.ralph/models.cache.json) with a 1-hour TTL
// so subsequent startups are instant.

import Fuse from "fuse.js";
import { mkdirSync } from "fs";
import { join } from "path";
import type { ModelInfo } from "../types.js";
import { findOpencodeBin } from "./runner.js";
import { RALPH_HOME } from "./config.js";

const CACHE_FILE = join(RALPH_HOME, "models.cache.json");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface ProviderModel {
  id: string;
  name: string;
  capabilities: {
    reasoning: boolean;
    [key: string]: unknown;
  };
  api: {
    id: string;
    url: string;
    npm: string;
  };
  variants?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

interface ProviderInfo {
  id: string;
  name: string;
  models: Record<string, ProviderModel>;
  [key: string]: unknown;
}

interface ProviderListResponse {
  all: ProviderInfo[];
  connected: string[];
}

/**
 * Fetch all available models from OpenCode via the SDK.
 * Starts a temporary server, queries provider.list(), then shuts down.
 * Only returns models from connected (authenticated) providers.
 */
export async function fetchModels(): Promise<ModelInfo[]> {
  const opencodeBin = await findOpencodeBin();
  const port = 14000 + Math.floor(Math.random() * 1000);
  const hostname = "127.0.0.1";

  const proc = Bun.spawn([opencodeBin, "serve", `--hostname=${hostname}`, `--port=${port}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const serverUrl = await waitForServer(proc, 15000);
    const { createOpencodeClient } = await import("@opencode-ai/sdk");
    const client = createOpencodeClient({ baseUrl: serverUrl });

    const result = await client.provider.list();
    const data = result.data as unknown as ProviderListResponse;

    const connectedSet = new Set(data.connected ?? []);
    const models: ModelInfo[] = [];

    for (const provider of (data.all ?? [])) {
      // Only include models from connected providers
      if (!connectedSet.has(provider.id)) continue;

      for (const [modelKey, model] of Object.entries(provider.models ?? {})) {
        models.push({
          id: `${provider.id}/${modelKey}`,
          name: model.name || modelKey,
          providerID: provider.id,
          modelID: modelKey,
          reasoning: model.capabilities?.reasoning ?? false,
          variants: model.variants ?? {},
        });
      }
    }

    return models;
  } finally {
    proc.kill();
  }
}

// ─── Cache Layer ──────────────────────────────────────────────────────────────

interface ModelCache {
  timestamp: number;
  models: ModelInfo[];
}

/** Read models from the disk cache if it exists and is within TTL. */
function loadFromCache(): ModelInfo[] | null {
  try {
    const file = Bun.file(CACHE_FILE);
    // Bun.file doesn't have a sync exists check, so we use readFileSync
    const text = require("fs").readFileSync(CACHE_FILE, "utf-8");
    const cache: ModelCache = JSON.parse(text);
    if (Date.now() - cache.timestamp < CACHE_TTL_MS && cache.models?.length > 0) {
      return cache.models;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write models to the disk cache. */
function saveToCache(models: ModelInfo[]): void {
  try {
    mkdirSync(RALPH_HOME, { recursive: true });
    const cache: ModelCache = { timestamp: Date.now(), models };
    require("fs").writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf-8");
  } catch {
    // Non-fatal — cache write failure shouldn't block the app
  }
}

/**
 * Get models, using the disk cache when possible.
 * @param forceRefresh - If true, bypass cache and fetch fresh data.
 */
export async function getModels(forceRefresh = false): Promise<ModelInfo[]> {
  if (!forceRefresh) {
    const cached = loadFromCache();
    if (cached) return cached;
  }

  const models = await fetchModels();
  saveToCache(models);
  return models;
}

/**
 * Wait for the OpenCode server to emit its "listening" line, extract URL.
 */
async function waitForServer(proc: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`OpenCode server did not start within ${timeoutMs}ms`));
    }, timeoutMs);

    let output = "";
    const decoder = new TextDecoder();

    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    const reader = stdout.getReader();
    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          output += decoder.decode(value);
          if (output.includes("listening")) {
            clearTimeout(timer);
            const match = output.match(/on\s+(https?:\/\/[^\s]+)/);
            if (match) {
              resolve(match[1]);
              return;
            }
            reject(new Error("Could not parse server URL from output"));
            return;
          }
        }
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    };

    read();
  });
}

/**
 * Create a Fuse.js instance for fuzzy model search.
 * Supports space-separated AND matching (e.g. "opus 4.6").
 */
export function createModelSearcher(models: ModelInfo[]): Fuse<ModelInfo> {
  return new Fuse(models, {
    keys: [
      { name: "id", weight: 0.6 },
      { name: "name", weight: 0.4 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    useExtendedSearch: true,
  });
}

/**
 * Search models with space-separated AND terms.
 * e.g. "opus 4.6" → matches models containing both "opus" AND "4.6"
 */
export function searchModels(fuse: Fuse<ModelInfo>, query: string): ModelInfo[] {
  if (!query.trim()) return fuse.getIndex().docs as unknown as ModelInfo[];

  const terms = query.trim().split(/\s+/);
  if (terms.length === 1) {
    return fuse.search(terms[0]).map((r) => r.item);
  }

  // AND search: use Fuse extended search with AND operator
  const pattern = terms.map((t) => `'${t}`).join(" ");
  return fuse.search(pattern).map((r) => r.item);
}
