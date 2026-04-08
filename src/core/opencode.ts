// ─── OpenCode Binary & Server Helpers ─────────────────────────────────────────
// Centralises binary lookup, subprocess spawning, and dev-server lifecycle
// so that runner.ts and models.ts don't depend on each other.

import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

let cachedBin: string | null = null;

/**
 * Find the opencode binary. Checks PATH first, then well-known locations.
 * Result is cached for the lifetime of the process.
 */
export async function findOpencodeBin(): Promise<string> {
  if (cachedBin) return cachedBin;

  // Check PATH
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    const candidate = join(dir, "opencode");
    if (existsSync(candidate)) {
      cachedBin = candidate;
      return candidate;
    }
  }

  // Well-known locations
  const candidates = [
    join(homedir(), ".opencode", "bin", "opencode"),
    join(homedir(), ".local", "bin", "opencode"),
    join(homedir(), "go", "bin", "opencode"),
    "/usr/local/bin/opencode",
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      cachedBin = c;
      return c;
    }
  }

  throw new Error(
    "Could not find opencode binary. Install it or add it to your PATH."
  );
}

/**
 * Start a temporary OpenCode dev-server and wait for it to be ready.
 * Returns the base URL (e.g. "http://127.0.0.1:14023").
 * The caller is responsible for killing the returned process.
 */
export async function startServer(
  timeoutMs = 15_000
): Promise<{ proc: ReturnType<typeof Bun.spawn>; url: string }> {
  const bin = await findOpencodeBin();
  const port = 14_000 + Math.floor(Math.random() * 1000);
  const hostname = "127.0.0.1";

  const proc = Bun.spawn([bin, "serve", `--hostname=${hostname}`, `--port=${port}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const url = await waitForServer(proc, timeoutMs);
  return { proc, url };
}

/**
 * Wait for the OpenCode server to emit its "listening" line, extract URL.
 */
async function waitForServer(
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs: number
): Promise<string> {
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
