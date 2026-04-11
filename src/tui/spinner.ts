// ─── Braille Spinner ──────────────────────────────────────────────────────────
// Smooth braille-dot animation for active tool lines.
// The spinner updates a single line in-place using ANSI cursor movement.
// In non-TTY contexts, it falls back to static output to avoid artifacts.

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const INTERVAL_MS = 80;

export { FRAMES, INTERVAL_MS };

export interface SpinnerWriter {
  write(text: string): void;
}

export interface SpinnerOptions {
  /** Override TTY detection (useful for testing). */
  isTTY?: boolean;
}

/**
 * A single-line braille spinner that overwrites its line in place.
 *
 * In TTY mode, uses ANSI escape sequences for in-place line updates.
 * In non-TTY mode, falls back to static output (no animation, no ANSI).
 *
 * Usage:
 *   const spinner = new Spinner(process.stdout);
 *   spinner.start("  ╭─ [tool] grep: searching...");
 *   // ... later ...
 *   spinner.stop("  ╭─ [tool] grep: done");
 */
export class Spinner {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentText = "";
  private writer: SpinnerWriter;
  private isTTY: boolean;

  constructor(writer: SpinnerWriter, opts?: SpinnerOptions) {
    this.writer = writer;
    this.isTTY = opts?.isTTY ?? (typeof process !== "undefined" && !!process.stdout?.isTTY);
  }

  /** Whether the spinner is currently animating. */
  get active(): boolean {
    return this.timer !== null;
  }

  /**
   * Start spinning on a line. The text should include the tree prefix
   * but NOT the spinner character — that gets prepended automatically.
   *
   * @param text - The line content after the spinner glyph,
   *               e.g. "  │  ╰─ [tool] bash: running tests"
   */
  start(text: string): void {
    this.stop();
    this.currentText = text;
    this.frame = 0;

    if (!this.isTTY) {
      // Non-TTY: just write the text with a static spinner glyph, no animation
      return;
    }

    this.draw();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.draw();
    }, INTERVAL_MS);
  }

  /**
   * Stop the spinner and replace it with a final static line.
   *
   * @param finalText - The completed line to display (full line including prefix).
   *                    If omitted, the current line is cleared.
   */
  stop(finalText?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (finalText !== undefined) {
      if (this.isTTY) {
        // Overwrite the spinner line with the final text
        this.writer.write(`\r\x1b[2K${finalText}\n`);
      } else {
        // Non-TTY: just write the final text on a new line
        this.writer.write(`${finalText}\n`);
      }
    }
  }

  /**
   * Update the text content without restarting the spinner.
   */
  update(text: string): void {
    this.currentText = text;
    if (this.active) {
      this.draw();
    }
  }

  private draw(): void {
    const glyph = FRAMES[this.frame];
    // \r moves to start of line, \x1b[2K clears the line
    this.writer.write(`\r\x1b[2K${this.currentText.replace("{spin}", glyph)}`);
  }
}
