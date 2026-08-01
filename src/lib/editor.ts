/**
 * Detect which IDE owns this terminal so jump-links open in the right app.
 * Override with SENTINEL_EDITOR=cursor|vscode|auto
 */
export type EditorKind = "cursor" | "vscode";

export function detectEditor(): EditorKind {
  const forced = (process.env.SENTINEL_EDITOR || "auto").toLowerCase();
  if (forced === "cursor") return "cursor";
  if (forced === "vscode") return "vscode";

  // Cursor-specific signals
  if (
    process.env.CURSOR_TRACE_ID ||
    process.env.CURSOR_AGENT ||
    process.env.CURSOR_SESSION_ID ||
    process.env.CURSOR_EXTENSION_HOST ||
    (process.env.TERM_PROGRAM_VERSION &&
      String(process.env.VSCODE_GIT_ASKPASS_NODE || "")
        .toLowerCase()
        .includes("cursor")) ||
    String(process.env.VSCODE_GIT_ASKPASS_NODE || "")
      .toLowerCase()
      .includes("cursor") ||
    String(process.env.VSCODE_INJECTION || "").toLowerCase().includes("cursor") ||
    String(process.execPath || "").toLowerCase().includes("cursor")
  ) {
    return "cursor";
  }

  // Vanilla VS Code
  if (
    process.env.TERM_PROGRAM === "vscode" ||
    process.env.VSCODE_PID ||
    process.env.VSCODE_INJECTION
  ) {
    return "vscode";
  }

  // Default: Cursor (this project is Cursor-first)
  return "cursor";
}

export function editorScheme(): string {
  return detectEditor() === "cursor" ? "cursor" : "vscode";
}

export function editorLabel(): string {
  return detectEditor() === "cursor" ? "Cursor" : "VS Code";
}
