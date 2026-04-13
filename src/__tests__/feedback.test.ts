import { describe, test, expect } from "bun:test";
import {
  FeedbackQueue,
  RawInputHandler,
  type InputStatusBar,
  type FeedbackQueueLike,
} from "../tui/feedback.js";

// ─── FeedbackQueue ──────────────────────────────────────────────────────────

describe("FeedbackQueue", () => {
  test("drain returns null when empty", () => {
    const q = new FeedbackQueue();
    expect(q.drain()).toBeNull();
  });

  test("hasPending returns false when empty", () => {
    const q = new FeedbackQueue();
    expect(q.hasPending()).toBe(false);
  });

  test("push and drain single message", () => {
    const q = new FeedbackQueue();
    q.push("hello");
    expect(q.hasPending()).toBe(true);
    expect(q.drain()).toBe("hello");
    expect(q.hasPending()).toBe(false);
    expect(q.drain()).toBeNull();
  });

  test("drain concatenates multiple messages with newlines", () => {
    const q = new FeedbackQueue();
    q.push("first");
    q.push("second");
    q.push("third");
    expect(q.drain()).toBe("first\nsecond\nthird");
  });

  test("push trims whitespace", () => {
    const q = new FeedbackQueue();
    q.push("  hello  ");
    expect(q.drain()).toBe("hello");
  });

  test("push ignores empty and whitespace-only strings", () => {
    const q = new FeedbackQueue();
    q.push("");
    q.push("   ");
    q.push("\n");
    expect(q.hasPending()).toBe(false);
    expect(q.drain()).toBeNull();
  });

  test("drain clears the queue", () => {
    const q = new FeedbackQueue();
    q.push("a");
    q.push("b");
    q.drain();
    q.push("c");
    expect(q.drain()).toBe("c");
  });
});

// ─── RawInputHandler (key handling) ─────────────────────────────────────────

describe("RawInputHandler", () => {
  function createTestHandler() {
    const inputBufferCalls: string[] = [];
    const bar: InputStatusBar = {
      setInputBuffer(text: string) {
        inputBufferCalls.push(text);
      },
    };
    const queue = new FeedbackQueue();
    const handler = new RawInputHandler(bar, queue);
    return { handler, queue, inputBufferCalls };
  }

  function keyBuffer(str: string): Buffer {
    return Buffer.from(str, "utf-8");
  }

  test("printable characters accumulate in buffer", () => {
    const { handler, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("h"));
    handler.handleKey(keyBuffer("i"));
    expect(inputBufferCalls).toEqual(["h", "hi"]);
  });

  test("multi-character input in single buffer", () => {
    const { handler, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("hello"));
    // Each char is processed individually, so setInputBuffer is called for each
    expect(inputBufferCalls).toEqual(["h", "he", "hel", "hell", "hello"]);
  });

  test("backspace removes last character", () => {
    const { handler, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("abc"));
    handler.handleKey(keyBuffer("\x7f")); // backspace
    expect(inputBufferCalls[inputBufferCalls.length - 1]).toBe("ab");
  });

  test("backspace on empty buffer is no-op", () => {
    const { handler, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("\x7f"));
    expect(inputBufferCalls).toEqual([]);
  });

  test("Ctrl+U clears the buffer", () => {
    const { handler, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("hello"));
    handler.handleKey(keyBuffer("\x15")); // Ctrl+U
    expect(inputBufferCalls[inputBufferCalls.length - 1]).toBe("");
  });

  test("Enter with content submits to queue and clears buffer", () => {
    const { handler, queue, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("fix the bug"));
    handler.handleKey(keyBuffer("\r")); // Enter

    expect(queue.drain()).toBe("fix the bug");
    expect(inputBufferCalls[inputBufferCalls.length - 1]).toBe("");
  });

  test("Enter with empty buffer is no-op", () => {
    const { handler, queue, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("\r"));
    expect(queue.drain()).toBeNull();
    // setInputBuffer should not be called for empty enter
    expect(inputBufferCalls).toEqual([]);
  });

  test("Enter triggers abort on the current controller", () => {
    const { handler, queue } = createTestHandler();
    const ac = new AbortController();
    handler.setAbortController(ac);

    handler.handleKey(keyBuffer("feedback"));
    handler.handleKey(keyBuffer("\r"));

    expect(ac.signal.aborted).toBe(true);
    expect(queue.drain()).toBe("feedback");
  });

  test("Enter does not abort when buffer is empty", () => {
    const { handler } = createTestHandler();
    const ac = new AbortController();
    handler.setAbortController(ac);

    handler.handleKey(keyBuffer("\r"));

    expect(ac.signal.aborted).toBe(false);
  });

  test("arrow key escape sequences are ignored", () => {
    const { handler, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("a"));
    // Arrow up: \x1b[A
    handler.handleKey(keyBuffer("\x1b[A"));
    handler.handleKey(keyBuffer("b"));
    expect(inputBufferCalls[inputBufferCalls.length - 1]).toBe("ab");
  });

  test("escape sequences in mixed input are skipped correctly", () => {
    const { handler, inputBufferCalls } = createTestHandler();
    // Type 'x', then arrow down (\x1b[B), then 'y' — all in one buffer
    handler.handleKey(keyBuffer("x\x1b[By"));
    expect(inputBufferCalls[inputBufferCalls.length - 1]).toBe("xy");
  });

  test("control characters below 0x20 (except handled ones) are ignored", () => {
    const { handler, inputBufferCalls } = createTestHandler();
    handler.handleKey(keyBuffer("a"));
    handler.handleKey(keyBuffer("\x01")); // Ctrl+A — should be ignored
    handler.handleKey(keyBuffer("\x02")); // Ctrl+B — should be ignored
    handler.handleKey(keyBuffer("b"));
    expect(inputBufferCalls[inputBufferCalls.length - 1]).toBe("ab");
  });

  test("newline (\\n) also submits feedback like Enter (\\r)", () => {
    const { handler, queue } = createTestHandler();
    handler.handleKey(keyBuffer("test"));
    handler.handleKey(keyBuffer("\n"));
    expect(queue.drain()).toBe("test");
  });

  test("multiple submissions work correctly", () => {
    const { handler, queue, inputBufferCalls } = createTestHandler();

    handler.handleKey(keyBuffer("first"));
    handler.handleKey(keyBuffer("\r"));
    expect(queue.drain()).toBe("first");

    handler.handleKey(keyBuffer("second"));
    handler.handleKey(keyBuffer("\r"));
    expect(queue.drain()).toBe("second");

    // Buffer was cleared each time
    const emptyBufferCalls = inputBufferCalls.filter((b) => b === "");
    expect(emptyBufferCalls.length).toBe(2);
  });

  test("abort controller can be swapped between submissions", () => {
    const { handler } = createTestHandler();

    const ac1 = new AbortController();
    handler.setAbortController(ac1);
    handler.handleKey(keyBuffer("msg1\r"));
    expect(ac1.signal.aborted).toBe(true);

    const ac2 = new AbortController();
    handler.setAbortController(ac2);
    handler.handleKey(keyBuffer("msg2\r"));
    expect(ac2.signal.aborted).toBe(true);
  });
});
