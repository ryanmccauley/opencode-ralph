// ─── Status Bar ───────────────────────────────────────────────────────────────
// Floating footer pinned to the bottom of the terminal during a session.
// Uses ANSI scroll regions so agent output scrolls above the bar.
//
// Layout without input (bottom 2 lines):
//   ───────────────────────────────────────────────────────
//    iter 2/50  ·  3m 42s  ·  anthropic/claude-sonnet-4  ·  thinking: high
//
// Layout with input enabled (bottom 3 lines):
//   ───────────────────────────────────────────────────────
//    iter 2/50  ·  3m 42s  ·  anthropic/claude-sonnet-4  ·  thinking: high
//    > type feedback here...

import { styleText } from "node:util";

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const ESC = "\x1b[";

/** Set scroll region to rows [top, bottom] (1-indexed). */
const setScrollRegion = (top: number, bottom: number) =>
  `${ESC}${top};${bottom}r`;

/** Reset scroll region to full terminal. */
const resetScrollRegion = () => `${ESC}r`;

/** Move cursor to (row, col) — 1-indexed. */
const moveTo = (row: number, col: number) => `${ESC}${row};${col}H`;

/** Save cursor position. */
const saveCursor = () => `${ESC}s`;

/** Restore cursor position. */
const restoreCursor = () => `${ESC}u`;

/** Clear the current line. */
const clearLine = () => `${ESC}2K`;

/** Hide cursor. */
const hideCursor = () => `${ESC}?25l`;

/** Show cursor. */
const showCursor = () => `${ESC}?25h`;

// ─── Time formatting ─────────────────────────────────────────────────────────

/**
 * Format elapsed milliseconds into a human-readable duration.
 * - Under 60s:   "42s"
 * - Under 1h:    "3m 42s"
 * - 1h+:         "1h 05m 12s"
 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }
  if (m > 0) {
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  return `${s}s`;
}

// ─── Footer rendering ────────────────────────────────────────────────────────

export interface StatusBarInfo {
  iteration: number;
  maxIter: number;
  model: string;
  thinking: string;
  startTime: number;
}

/**
 * Render the footer content string (without ANSI positioning).
 * Exported for testing.
 */
export function renderFooter(info: StatusBarInfo): string {
  return renderFooterAtTime(info, Date.now());
}

/**
 * Render footer using an injected timestamp (for deterministic tests).
 */
export function renderFooterAtTime(info: StatusBarInfo, nowMs: number): string {
  const elapsed = formatElapsed(nowMs - info.startTime);
  const parts = [
    `iter ${info.iteration}/${info.maxIter}`,
    elapsed,
    info.model,
    `thinking: ${info.thinking}`,
  ];
  return ` ${parts.join("  \u00b7  ")}`;
}

// ─── Minimum terminal height to enable the bar ──────────────────────────────

const MIN_ROWS = 5;

// ─── StatusBar class ─────────────────────────────────────────────────────────

export interface StatusBarOptions {
  model: string;
  thinking: string;
  maxIter: number;
  /** When true, reserve an extra line for the feedback input prompt. */
  enableInput?: boolean;
}

export class StatusBar {
  private model: string;
  private thinking: string;
  private maxIter: number;
  private enableInput: boolean;
  private iteration = 0;
  private startTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rows = 0;
  private cols = 0;
  private active = false;
  private onResize: (() => void) | null = null;
  private inputBuffer = "";

  constructor(opts: StatusBarOptions) {
    this.model = opts.model;
    this.thinking = opts.thinking;
    this.maxIter = opts.maxIter;
    this.enableInput = opts.enableInput ?? false;
  }

  /** Number of terminal lines reserved at the bottom. */
  private get reservedLines(): number {
    return this.enableInput ? 3 : 2;
  }

  /** Whether the status bar is currently active (scroll region set). */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Start the status bar. Sets scroll region, draws the footer,
   * and begins updating the elapsed timer every second.
   */
  start(): void {
    this.startTime = Date.now();
    this.iteration = 0;
    this.rows = process.stdout.rows ?? 0;
    this.cols = process.stdout.columns ?? 80;

    if (this.rows < MIN_ROWS) return;

    this.active = true;

    // Set scroll region to exclude the bottom reserved lines
    this.applyScrollRegion();
    this.draw();

    // Update elapsed time every second
    this.timer = setInterval(() => this.draw(), 1000);

    // Handle terminal resize
    this.onResize = () => {
      this.rows = process.stdout.rows ?? 0;
      this.cols = process.stdout.columns ?? 80;

      if (this.rows < MIN_ROWS) {
        // Terminal too small — disable the bar
        this.teardown();
        return;
      }

      this.applyScrollRegion();
      this.draw();
    };
    process.stdout.on("resize", this.onResize);
  }

  /**
   * Update the current iteration number and redraw the footer.
   */
  setIteration(current: number): void {
    this.iteration = current;
    if (this.active) this.draw();
  }

  /**
   * Write output text to stdout within the scroll region.
   * Ensures the cursor stays in the scroll area so the footer isn't overwritten.
   */
  write(text: string): void {
    if (!this.active) {
      process.stdout.write(text);
      return;
    }

    // Save cursor, move to bottom of scroll region, restore after write
    // Actually: the scroll region already confines output. We just need to
    // make sure the cursor is inside the scroll region before writing.
    // The cursor should already be there, so just write directly.
    process.stdout.write(text);
  }

  /**
   * Stop the status bar. Clears the timer, resets the scroll region,
   * and moves the cursor below the footer area.
   */
  stop(): void {
    if (!this.active) return;
    this.teardown();

    // Clear all reserved lines at the bottom
    const firstReservedRow = this.rows - this.reservedLines + 1;
    let clearSeq = "";
    for (let r = firstReservedRow; r <= this.rows; r++) {
      clearSeq += moveTo(r, 1) + clearLine();
    }

    process.stdout.write(
      clearSeq +
      resetScrollRegion() +
      moveTo(firstReservedRow, 1) +
      showCursor()
    );
  }

  /**
   * Update the input line buffer and redraw just the input line.
   * Called by the RawInputHandler on each keystroke.
   */
  setInputBuffer(text: string): void {
    this.inputBuffer = text;
    if (this.active && this.enableInput) this.drawInput();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private applyScrollRegion(): void {
    // Scroll region: lines 1 to (rows - reservedLines) — reserves bottom lines
    const scrollBottom = this.rows - this.reservedLines;
    process.stdout.write(
      saveCursor() +
      setScrollRegion(1, scrollBottom) +
      restoreCursor()
    );
  }

  private draw(): void {
    if (!this.active) return;

    const info: StatusBarInfo = {
      iteration: this.iteration,
      maxIter: this.maxIter,
      model: this.model,
      thinking: this.thinking,
      startTime: this.startTime,
    };

    // With input: separator at rows-2, footer at rows-1, input at rows
    // Without:    separator at rows-1, footer at rows
    const separatorRow = this.rows - this.reservedLines + 1;
    const footerRow = separatorRow + 1;

    const separator = "\u2500".repeat(this.cols);
    const content = renderFooter(info);

    // Truncate content if wider than terminal
    const displayContent =
      content.length > this.cols ? content.slice(0, this.cols) : content;

    let output =
      saveCursor() +
      hideCursor() +
      moveTo(separatorRow, 1) +
      clearLine() +
      styleText("dim", separator) +
      moveTo(footerRow, 1) +
      clearLine() +
      displayContent;

    if (this.enableInput) {
      output += this.renderInputLine();
    }

    output += restoreCursor() + showCursor();
    process.stdout.write(output);
  }

  /**
   * Render just the input line without touching separator/footer.
   * Used for responsive keystroke feedback.
   */
  private drawInput(): void {
    if (!this.active || !this.enableInput) return;

    process.stdout.write(
      saveCursor() +
      hideCursor() +
      this.renderInputLine() +
      restoreCursor() +
      showCursor()
    );
  }

  /**
   * Build the ANSI sequence for the input line (no save/restore cursor).
   * Used by both draw() and drawInput().
   */
  private renderInputLine(): string {
    const inputRow = this.rows;
    const prompt = "> ";
    const maxLen = this.cols - prompt.length;
    // Show the tail of the buffer if it exceeds terminal width
    const display =
      this.inputBuffer.length > maxLen
        ? this.inputBuffer.slice(-maxLen)
        : this.inputBuffer;

    return (
      moveTo(inputRow, 1) +
      clearLine() +
      styleText("dim", prompt) +
      display
    );
  }

  private teardown(): void {
    this.active = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.onResize) {
      process.stdout.off("resize", this.onResize);
      this.onResize = null;
    }
  }
}

/**
 * Returns true if stdout is a TTY with enough rows for the status bar.
 * Used to decide whether to enable the bar at all.
 */
export function canShowStatusBar(): boolean {
  return !!(
    process.stdout.isTTY &&
    (process.stdout.rows ?? 0) >= MIN_ROWS
  );
}
