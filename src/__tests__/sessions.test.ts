import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  generateSessionId,
  saveSessionMeta,
  getSessionMeta,
  listSessions,
  getLogPath,
} from "../core/sessions.js";
import { buildSessionMeta } from "./session-fixtures.js";

describe("generateSessionId", () => {
  test("matches expected format: YYYY-MM-DD_HHMMSS_xxxx", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}_[a-z0-9]{4}$/);
  });

  test("two consecutive calls produce different IDs (collision safety)", () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
  });
});

describe("session storage", () => {
  let tempDirs: string[];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempSessionsDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "ralph-test-"));
    tempDirs.push(dir);
    return dir;
  }

  test("round-trips a session through save and load", async () => {
    const sessionsDir = makeTempSessionsDir();
    const sessionId = generateSessionId();

    const meta = buildSessionMeta({
      timestamp: sessionId,
      model: "anthropic/claude-sonnet-4",
      thinking: "high",
      prompt: "Fix all failing tests",
      status: "incomplete",
      iterations: 23,
    });

    await saveSessionMeta(meta, { sessionsDir });
    const loaded = await getSessionMeta(sessionId, { sessionsDir });

    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(meta);
  });

  test("preserves multi-line prompts through save/load", async () => {
    const sessionsDir = makeTempSessionsDir();
    const sessionId = generateSessionId();
    const prompt = "Fix these issues:\n1. Auth bug\n2. CSS layout\n3. API timeout";

    const meta = buildSessionMeta({
      timestamp: sessionId,
      model: "openai/gpt-4o",
      thinking: "off",
      prompt,
      status: "complete",
      iterations: 5,
      maxIter: 10,
    });

    await saveSessionMeta(meta, { sessionsDir });
    const loaded = await getSessionMeta(sessionId, { sessionsDir });

    expect(loaded?.prompt).toBe(prompt);
    expect(loaded?.prompt).toContain("\n");
  });

  test("saving updated metadata overwrites the original", async () => {
    const sessionsDir = makeTempSessionsDir();
    const sessionId = generateSessionId();

    const original = buildSessionMeta({
      timestamp: sessionId,
      model: "anthropic/claude-sonnet-4",
      thinking: "off",
      prompt: "Do the thing",
      status: "incomplete",
      iterations: 50,
      maxIter: 50,
    });

    const resumed = buildSessionMeta({
      ...original,
      maxIter: 70,
      status: "complete",
      iterations: 63,
    });

    await saveSessionMeta(original, { sessionsDir });
    await saveSessionMeta(resumed, { sessionsDir });

    const loaded = await getSessionMeta(sessionId, { sessionsDir });
    expect(loaded).toEqual(resumed);
  });

  test("listSessions returns saved sessions newest-first by filename", async () => {
    const sessionsDir = makeTempSessionsDir();

    const older = buildSessionMeta({
      timestamp: "2026-04-01_010101_abcd",
      model: "provider/one",
      thinking: "off",
      maxIter: 10,
      prompt: "older",
      status: "incomplete",
      iterations: 2,
    });
    const newer = buildSessionMeta({
      timestamp: "2026-04-02_010101_wxyz",
      model: "provider/two",
      thinking: "high",
      maxIter: 20,
      prompt: "newer",
      status: "complete",
      iterations: 7,
    });

    await saveSessionMeta(older, { sessionsDir });
    await saveSessionMeta(newer, { sessionsDir });

    const sessions = await listSessions({ sessionsDir });
    expect(sessions.map((s) => s.timestamp)).toEqual([
      newer.timestamp,
      older.timestamp,
    ]);
  });

  test("getSessionMeta supports legacy .meta fallback", async () => {
    const sessionsDir = makeTempSessionsDir();
    const sessionId = "2026-04-08_143022_a7x3";

    const legacy = buildSessionMeta({
      timestamp: sessionId,
      prompt: "legacy prompt",
      status: "complete",
      iterations: 9,
    });

    const legacyBody = [
      `timestamp=${legacy.timestamp}`,
      `model=${legacy.model}`,
      `thinking=${legacy.thinking}`,
      `max_iter=${legacy.maxIter}`,
      `prompt=${legacy.prompt}`,
      `status=${legacy.status}`,
      `iterations=${legacy.iterations}`,
      "",
    ].join("\n");

    await Bun.write(join(sessionsDir, `${sessionId}.meta`), legacyBody);

    const loaded = await getSessionMeta(sessionId, { sessionsDir });
    expect(loaded).toEqual(buildSessionMeta({
      timestamp: sessionId,
      prompt: "legacy prompt",
      status: "complete",
      iterations: 9,
    }));
  });

  test("getLogPath respects overridden sessions dir", () => {
    const sessionsDir = makeTempSessionsDir();
    const path = getLogPath("session-123", { sessionsDir });
    expect(path).toBe(join(sessionsDir, "session-123.log"));
  });
});
