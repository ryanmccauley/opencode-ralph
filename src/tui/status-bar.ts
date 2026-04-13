// ─── Status Bar ───────────────────────────────────────────────────────────────
// Floating footer pinned to the bottom of the terminal during a session.
// Uses ANSI scroll regions so agent output scrolls above the bar.
//
// Layout without input (bottom 3 lines):
//   ╭──────────────────────────────────────────────────────────────────────────╮
//   │  iter 2/50  ·  3m 42s                 anthropic/claude-sonnet-4  ·  high │
//   ╰──────────────────────────────────────────────────────────────────────────╯
//
// Layout with input enabled (bottom 4 lines):
//   ╭──────────────────────────────────────────────────────────────────────────╮
//   │  iter 2/50  ·  3m 42s                 anthropic/claude-sonnet-4  ·  high │
//   │  > type feedback here...                                                 │
//   ╰──────────────────────────────────────────────────────────────────────────╯

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

// ─── Box-drawing characters ─────────────────────────────────────────────────

const BOX = {
  topLeft: "\u256d",     // ╭
  topRight: "\u256e",    // ╮
  bottomLeft: "\u2570",  // ╰
  bottomRight: "\u256f", // ╯
  horizontal: "\u2500",  // ─
  vertical: "\u2502",    // │
} as const;

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
 * Render the footer content parts (without ANSI positioning or styling).
 * Returns left-aligned progress info and right-aligned config info.
 * Exported for testing.
 */
export function renderFooterParts(
  info: StatusBarInfo,
  nowMs: number
): { left: string; right: string } {
  const elapsed = formatElapsed(nowMs - info.startTime);
  return {
    left: `iter ${info.iteration}/${info.maxIter}  \u00b7  ${elapsed}`,
    right: `${info.model}  \u00b7  ${info.thinking}`,
  };
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
  const { left, right } = renderFooterParts(info, nowMs);
  return `  ${left}    ${right}  `;
}

// ─── Minimum terminal height to enable the bar ──────────────────────────────

const MIN_ROWS = 6;

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

  /**
   * Number of terminal lines reserved at the bottom.
   * Without input: 3 (top border + info + bottom border)
   * With input:    4 (top border + info + input + bottom border)
   */
  private get reservedLines(): number {
    return this.enableInput ? 4 : 3;
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

    // The scroll region already confines output. The cursor should
    // already be inside the scroll region, so just write directly.
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
    // Scroll region: lines 1 to (rows - reservedLines)
    const scrollBottom = this.rows - this.reservedLines;
    process.stdout.write(
      saveCursor() +
      setScrollRegion(1, scrollBottom) +
      restoreCursor()
    );
  }

  private draw(): void {
    if (!this.active) return;

    const innerWidth = Math.max(0, this.cols - 2); // cols minus │ on each side

    // ─── Build box borders ─────────────────────────────────────────────
    const topBorder =
      BOX.topLeft + BOX.horizontal.repeat(innerWidth) + BOX.topRight;
    const bottomBorder =
      BOX.bottomLeft + BOX.horizontal.repeat(innerWidth) + BOX.bottomRight;

    // ─── Build info line with Layout D: left progress, right config ────
    const nowMs = Date.now();
    const elapsed = formatElapsed(nowMs - this.startTime);

    // Plain-text segments for width calculation
    const leftText = `  iter ${this.iteration}/${this.maxIter}  \u00b7  ${elapsed}`;
    const rightText = `${this.model}  \u00b7  ${this.thinking}  `;
    const gap = Math.max(2, innerWidth - leftText.length - rightText.length);

    // Styled segments: dim labels/separators, normal values
    const leftStyled =
      "  " +
      styleText("dim", "iter ") +
      styleText("bold", `${this.iteration}/${this.maxIter}`) +
      styleText("dim", "  \u00b7  ") +
      styleText("bold", elapsed);

    const rightStyled =
      this.model +
      styleText("dim", "  \u00b7  ") +
      this.thinking +
      "  ";

    const infoLine =
      BOX.vertical + leftStyled + " ".repeat(gap) + rightStyled + BOX.vertical;

    // ─── Row positions ─────────────────────────────────────────────────
    const topRow = this.rows - this.reservedLines + 1;
    const infoRow = topRow + 1;
    // inputRow and bottomRow depend on enableInput
    const bottomRow = this.rows;

    // ─── Assemble output ───────────────────────────────────────────────
    let output =
      saveCursor() +
      hideCursor() +
      moveTo(topRow, 1) +
      clearLine() +
      styleText("dim", topBorder) +
      moveTo(infoRow, 1) +
      clearLine() +
      infoLine;

    if (this.enableInput) {
      const inputRow = infoRow + 1;
      output += this.renderInputLine(inputRow, innerWidth);
      output +=
        moveTo(bottomRow, 1) +
        clearLine() +
        styleText("dim", bottomBorder);
    } else {
      output +=
        moveTo(bottomRow, 1) +
        clearLine() +
        styleText("dim", bottomBorder);
    }

    output += restoreCursor() + showCursor();
    process.stdout.write(output);
  }

  /**
   * Render just the input line without touching borders/info.
   * Used for responsive keystroke feedback.
   */
  private drawInput(): void {
    if (!this.active || !this.enableInput) return;

    const innerWidth = Math.max(0, this.cols - 2);
    const inputRow = this.rows - this.reservedLines + 3; // topRow+2

    process.stdout.write(
      saveCursor() +
      hideCursor() +
      this.renderInputLine(inputRow, innerWidth) +
      restoreCursor() +
      showCursor()
    );
  }

  /**
   * Build the ANSI sequence for the input line inside the box.
   * Used by both draw() and drawInput().
   */
  private renderInputLine(row: number, innerWidth: number): string {
    const prompt = "> ";
    const padding = 2; // left margin inside box
    const maxLen = innerWidth - padding - prompt.length;
    // Show the tail of the buffer if it exceeds available width
    const display =
      this.inputBuffer.length > maxLen
        ? this.inputBuffer.slice(-maxLen)
        : this.inputBuffer;

    const contentLen = padding + prompt.length + display.length;
    const trailingSpace = Math.max(0, innerWidth - contentLen);

    return (
      moveTo(row, 1) +
      clearLine() +
      styleText("dim", BOX.vertical) +
      " ".repeat(padding) +
      styleText("dim", prompt) +
      display +
      " ".repeat(trailingSpace) +
      styleText("dim", BOX.vertical)
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
