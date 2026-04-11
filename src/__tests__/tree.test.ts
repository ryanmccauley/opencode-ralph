import { describe, test, expect } from "bun:test";
import { TreeState, GLYPHS } from "../tui/tree.js";

describe("TreeState", () => {
  test("empty tree produces empty prefix", () => {
    const tree = new TreeState();
    expect(tree.depth).toBe(0);
  });

  test("first child gets ╭─ prefix", () => {
    const tree = new TreeState();
    tree.open();
    expect(tree.prefix(false)).toBe(GLYPHS.first);
  });

  test("middle child gets ├─ prefix", () => {
    const tree = new TreeState();
    tree.open();
    tree.prefix(false); // first child
    expect(tree.prefix(false)).toBe(GLYPHS.middle);
  });

  test("last child gets ╰─ prefix", () => {
    const tree = new TreeState();
    tree.open();
    tree.prefix(false); // first child
    expect(tree.prefix(true)).toBe(GLYPHS.last);
  });

  test("single child that is last gets ╭─ then next call with isLast gets ╰─", () => {
    const tree = new TreeState();
    tree.open();
    // First and only child
    const first = tree.prefix(false);
    expect(first).toBe(GLYPHS.first);
    const last = tree.prefix(true);
    expect(last).toBe(GLYPHS.last);
  });

  test("nested levels produce correct rail prefixes", () => {
    const tree = new TreeState();

    // Level 0: open agent branch
    tree.open();
    const agentPrefix = tree.prefix(false);
    expect(agentPrefix).toBe(GLYPHS.first); // "╭─ "

    // Level 1: open tool branch inside agent
    tree.open();
    const toolPrefix = tree.prefix(false);
    // Should have rail for level 0, then first for level 1
    expect(toolPrefix).toBe(GLYPHS.rail + GLYPHS.first);
  });

  test("nested middle children show rails correctly", () => {
    const tree = new TreeState();

    tree.open(); // agent level
    tree.prefix(false); // first agent

    tree.open(); // tool level
    tree.prefix(false); // first tool: "│  ╭─ "
    const middleTool = tree.prefix(false); // second tool: "│  ├─ "
    expect(middleTool).toBe(GLYPHS.rail + GLYPHS.middle);
  });

  test("closed parent shows blank instead of rail", () => {
    const tree = new TreeState();

    tree.open(); // agent level
    tree.prefix(true); // last (only) agent — marks level as closed

    tree.open(); // tool level
    const toolPrefix = tree.prefix(false);
    // Parent is closed, so blank instead of rail
    expect(toolPrefix).toBe(GLYPHS.blank + GLYPHS.first);
  });

  test("continuation returns rails for all open levels", () => {
    const tree = new TreeState();
    tree.open();
    tree.prefix(false); // first child, level still open
    tree.open();
    tree.prefix(false); // first child at level 1

    const cont = tree.continuation();
    expect(cont).toBe(GLYPHS.rail + GLYPHS.rail);
  });

  test("continuation with closed level shows blank", () => {
    const tree = new TreeState();
    tree.open();
    tree.prefix(true); // last child — closes level
    tree.open();
    tree.prefix(false);

    const cont = tree.continuation();
    expect(cont).toBe(GLYPHS.blank + GLYPHS.rail);
  });

  test("blankLine returns rails for breathing room", () => {
    const tree = new TreeState();
    tree.open();
    tree.prefix(false);

    const blank = tree.blankLine();
    expect(blank).toBe(GLYPHS.rail);
  });

  test("open and close manage depth correctly", () => {
    const tree = new TreeState();
    expect(tree.depth).toBe(0);

    tree.open();
    expect(tree.depth).toBe(1);

    tree.open();
    expect(tree.depth).toBe(2);

    tree.close();
    expect(tree.depth).toBe(1);

    tree.close();
    expect(tree.depth).toBe(0);
  });

  test("reset clears all state", () => {
    const tree = new TreeState();
    tree.open();
    tree.open();
    tree.prefix(false);

    tree.reset();
    expect(tree.depth).toBe(0);
  });

  test("three-level deep nesting", () => {
    const tree = new TreeState();

    // Session > Agent > Tool
    tree.open(); // session
    tree.prefix(false); // first agent

    tree.open(); // agent
    tree.prefix(false); // first tool

    tree.open(); // tool detail
    const deepPrefix = tree.prefix(false);
    expect(deepPrefix).toBe(GLYPHS.rail + GLYPHS.rail + GLYPHS.first);

    tree.close();
    tree.close();
    tree.close();
    expect(tree.depth).toBe(0);
  });

  test("multiple siblings at same level", () => {
    const tree = new TreeState();
    tree.open();

    const first = tree.prefix(false);
    const second = tree.prefix(false);
    const third = tree.prefix(false);
    const last = tree.prefix(true);

    expect(first).toBe(GLYPHS.first);    // ╭─
    expect(second).toBe(GLYPHS.middle);  // ├─
    expect(third).toBe(GLYPHS.middle);   // ├─
    expect(last).toBe(GLYPHS.last);      // ╰─
  });
});
