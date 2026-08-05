/**
 * Raw-mode keypress wiring for the full-screen TUI.
 *
 * Uses `readline.emitKeypressEvents` + raw mode; no prompt/interface is
 * created so the TUI owns rendering entirely. Ctrl+C is surfaced as a normal
 * key (ctrl + name "c") and handled by the caller.
 */

import readline from "node:readline";

export interface KeyInfo {
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  sequence: string;
}

/** Enable raw-mode keypress events; returns a cleanup function. */
export function startKeypress(onKey: (key: KeyInfo) => void): () => void {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();

  const handler = (input: string, key: readline.Key): void => {
    onKey({
      name: key.name ?? input,
      ctrl: key.ctrl ?? false,
      shift: key.shift ?? false,
      meta: key.meta ?? false,
      sequence: input,
    });
  };
  process.stdin.on("keypress", handler);

  return () => {
    process.stdin.removeListener("keypress", handler);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  };
}
