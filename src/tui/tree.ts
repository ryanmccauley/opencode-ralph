// ─── Tree State Tracker ───────────────────────────────────────────────────────
// Manages nested branch state and produces the correct tree-drawing prefix
// for each line of output.
//
// Visual grammar:
//   ╭─  first child
//   ├─  middle child
//   ╰─  last child
//   │   continuation rail
//       empty indent (under a closed branch)

/** A single level in the nesting stack. */
interface BranchLevel {
  /** Whether more siblings can appear at this level. */
  open: boolean;
}

/** Characters used to draw the tree. */
const GLYPHS = {
  first: "╭─ ",
  middle: "├─ ",
  last: "╰─ ",
  rail: "│  ",
  blank: "   ",
} as const;

export { GLYPHS };

/**
 * Pure tree-state tracker.
 *
 * Usage:
 *   const tree = new TreeState();
 *   tree.open();                     // push a new branch level
 *   tree.prefix(false);              // "╭─ " (first child, not last)
 *   tree.prefix(false);              // "├─ " (middle child)
 *   tree.prefix(true);               // "╰─ " (last child)
 *   tree.close();                    // pop the level
 *
 * Deeper nesting works by calling open/close at each level. The prefix
 * method returns the full multi-level prefix string including rails for
 * all ancestor levels.
 */
export class TreeState {
  private stack: BranchLevel[] = [];
  /** How many children have been emitted at the current level. */
  private childCounts: number[] = [];

  /** Current nesting depth. */
  get depth(): number {
    return this.stack.length;
  }

  /** Push a new branch level (entering an agent or nested scope). */
  open(): void {
    this.stack.push({ open: true });
    this.childCounts.push(0);
  }

  /** Close the current branch level. */
  close(): void {
    this.stack.pop();
    this.childCounts.pop();
  }

  /**
   * Mark the current level as having no more siblings.
   * The next prefix at this level will use ╰─ instead of ├─.
   */
  markLast(): void {
    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].open = false;
    }
  }

  /**
   * Build the tree prefix string for a line at the current depth.
   *
   * @param isLast - Whether this is the last child at the current level.
   *                 If true, uses ╰─ and marks the level closed.
   */
  prefix(isLast: boolean): string {
    if (this.stack.length === 0) return "";

    // Build ancestor rails
    let result = "";
    for (let i = 0; i < this.stack.length - 1; i++) {
      result += this.stack[i].open ? GLYPHS.rail : GLYPHS.blank;
    }

    // Current level glyph
    const count = this.childCounts[this.childCounts.length - 1];
    if (count === 0) {
      result += GLYPHS.first;
    } else if (isLast) {
      result += GLYPHS.last;
    } else {
      result += GLYPHS.middle;
    }

    this.childCounts[this.childCounts.length - 1] = count + 1;

    if (isLast) {
      this.stack[this.stack.length - 1].open = false;
    }

    return result;
  }

  /**
   * Build a continuation prefix for sub-lines (e.g. tool output lines
   * indented under their tool call).
   *
   * This produces the rail characters for all open levels without any
   * branch glyph at the end.
   */
  continuation(): string {
    let result = "";
    for (const level of this.stack) {
      result += level.open ? GLYPHS.rail : GLYPHS.blank;
    }
    return result;
  }

  /**
   * Build a blank-line prefix (shows rails for open ancestor levels only,
   * used for visual breathing room between sibling agents).
   */
  blankLine(): string {
    if (this.stack.length === 0) return "";

    let result = "";
    for (let i = 0; i < this.stack.length - 1; i++) {
      result += this.stack[i].open ? GLYPHS.rail : GLYPHS.blank;
    }
    // The current level shows a rail if still open, blank if closed
    result += this.stack[this.stack.length - 1].open ? GLYPHS.rail : GLYPHS.blank;
    return result;
  }

  /** Reset to empty state. */
  reset(): void {
    this.stack = [];
    this.childCounts = [];
  }
}
