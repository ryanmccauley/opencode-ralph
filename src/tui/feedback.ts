// ─── Feedback ────────────────────────────────────────────────────────────────
// Mid-session feedback queue and raw stdin input handler.
// Allows the user to type feedback while a session is running.
// Feedback is queued and injected into the next iteration's prompt, and the
// current iteration is aborted so the agent picks up the feedback immediately.

// ─── FeedbackQueue ──────────────────────────────────────────────────────────

export interface FeedbackQueueLike {
  push(msg: string): void;
  drain(): string | null;
  hasPending(): boolean;
}

/**
 * Simple queue for collecting user feedback messages during a session.
 * The runner drains the queue between iterations to inject feedback
 * into the next prompt.
 */
export class FeedbackQueue implements FeedbackQueueLike {
  private messages: string[] = [];

  /** Add a feedback message to the queue. Empty/whitespace-only strings are ignored. */
  push(msg: string): void {
    const trimmed = msg.trim();
    if (trimmed) {
      this.messages.push(trimmed);
    }
  }

  /**
   * Drain all queued messages, returning them joined by newlines.
   * Returns null if the queue is empty.
   */
  drain(): string | null {
    if (this.messages.length === 0) return null;
    const result = this.messages.join("\n");
    this.messages = [];
    return result;
  }

  /** Whether there are pending messages. */
  hasPending(): boolean {
    return this.messages.length > 0;
  }
}

// ─── Input handler interfaces ───────────────────────────────────────────────

/** Subset of StatusBar needed by the input handler. */
export interface InputStatusBar {
  setInputBuffer(text: string): void;
}

export interface InputHandlerLike {
  start(): void;
  stop(): void;
  setAbortController(ac: AbortController): void;
}

// ─── RawInputHandler ────────────────────────────────────────────────────────

/**
 * Captures raw stdin keypresses during a session and renders a live
 * input line in the status bar. On Enter, queues the feedback message
 * and aborts the current iteration so the agent picks it up.
 *
 * Keyboard handling:
 *   Enter       → submit feedback, abort current iteration
 *   Backspace   → delete last character
 *   Ctrl+U      → clear entire input line
 *   Ctrl+C      → stop handler and exit process
 *   Escape seqs → ignored (arrow keys, etc.)
 *   Printable   → append to buffer
 */
export class RawInputHandler implements InputHandlerLike {
  private buffer = "";
  private bar: InputStatusBar;
  private queue: FeedbackQueueLike;
  private abortController: AbortController | null = null;
  private active = false;
  private dataListener: ((data: Buffer) => void) | null = null;

  constructor(bar: InputStatusBar, queue: FeedbackQueueLike) {
    this.bar = bar;
    this.queue = queue;
  }

  /** Set the AbortController for the current iteration. */
  setAbortController(ac: AbortController): void {
    this.abortController = ac;
  }

  /** Start capturing raw stdin input. No-op if stdin is not a TTY. */
  start(): void {
    if (this.active) return;
    if (!process.stdin.isTTY) return;

    this.active = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    this.dataListener = (data: Buffer) => {
      this.handleKey(data);
    };
    process.stdin.on("data", this.dataListener);

    // Show empty input prompt
    this.bar.setInputBuffer("");
  }

  /** Stop capturing raw stdin input and restore terminal state. */
  stop(): void {
    if (!this.active) return;
    this.active = false;

    if (this.dataListener) {
      process.stdin.off("data", this.dataListener);
      this.dataListener = null;
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }

  /** @internal — exposed for testing. */
  handleKey(data: Buffer): void {
    const key = data.toString("utf-8");

    for (let i = 0; i < key.length; i++) {
      const ch = key[i];
      const code = key.charCodeAt(i);

      if (ch === "\r" || ch === "\n") {
        // Enter — submit feedback
        if (this.buffer.length > 0) {
          this.queue.push(this.buffer);
          this.buffer = "";
          this.bar.setInputBuffer("");
          // Abort the current iteration so the agent picks up feedback
          this.abortController?.abort();
        }
      } else if (code === 0x03) {
        // Ctrl+C — stop and exit
        this.stop();
        process.exit(0);
      } else if (code === 0x15) {
        // Ctrl+U — clear line
        this.buffer = "";
        this.bar.setInputBuffer("");
      } else if (code === 0x7f || code === 0x08) {
        // Backspace / Delete
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.bar.setInputBuffer(this.buffer);
        }
      } else if (code === 0x1b) {
        // Escape sequence — skip the rest of the sequence
        // Arrow keys come as \x1b[A, \x1b[B, etc.
        if (i + 1 < key.length && key[i + 1] === "[") {
          i += 2; // skip \x1b[
          // Skip until we hit the sequence terminator (a letter or ~)
          while (i < key.length && !/[A-Za-z~]/.test(key[i])) {
            i++;
          }
        }
      } else if (code >= 32) {
        // Printable character
        this.buffer += ch;
        this.bar.setInputBuffer(this.buffer);
      }
      // Ignore other control characters
    }
  }
}
