// ─── Theme Constants ──────────────────────────────────────────────────────────
// Monotone aesthetic: white, gray, black only.

import { styleText } from "node:util";

/** Dim gray text for labels and secondary info */
export function dim(text: string): string {
  return styleText("dim", text);
}
