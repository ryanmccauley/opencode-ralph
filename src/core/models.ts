// ─── Model Discovery via OpenCode SDK ─────────────────────────────────────────
// Starts a temporary OpenCode server, queries provider.list(), builds model list.
// Results are cached to disk (~/.ralph/models.cache.json) with a 1-hour TTL
// so subsequent startups are instant.

import Fuse from "fuse.js";
import { mkdirSync } from "fs";
import { join } from "path";
import type { ModelInfo } from "../types.js";
import { startServer, findOpencodeBin } from "./opencode.js";
import { getRalphHome } from "./config.js";

function getCacheFile(): string {
  return join(getRalphHome(), "models.cache.json");
}

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
  const { proc, url } = await startServer();

  try {
    const { createOpencodeClient } = await import("@opencode-ai/sdk");
    const client = createOpencodeClient({ baseUrl: url });

    const result = await client.provider.list();
    const data = result.data as unknown as ProviderListResponse;

    const connectedSet = new Set(data.connected ?? []);
    const models: ModelInfo[] = [];

    for (const provider of data.all ?? []) {
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
async function loadFromCache(): Promise<ModelInfo[] | null> {
  try {
    const file = Bun.file(getCacheFile());
    if (!(await file.exists())) return null;
    const cache: ModelCache = await file.json();
    if (Date.now() - cache.timestamp < CACHE_TTL_MS && cache.models?.length > 0) {
      return cache.models;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write models to the disk cache. */
async function saveToCache(models: ModelInfo[]): Promise<void> {
  try {
    const ralphHome = getRalphHome();
    mkdirSync(ralphHome, { recursive: true });
    const cache: ModelCache = { timestamp: Date.now(), models };
    await Bun.write(getCacheFile(), JSON.stringify(cache));
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
    const cached = await loadFromCache();
    if (cached) return cached;
  }

  const models = await fetchModels();
  await saveToCache(models);
  return models;
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
 * e.g. "opus 4.6" matches models containing both "opus" AND "4.6"
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
