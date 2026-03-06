import * as vscode from "vscode";
import type { EditorSettings } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getEditorSettings(): EditorSettings {
  const config = vscode.workspace.getConfiguration("ascii-sketch");
  return {
    defaultWidth: clamp(config.get<number>("defaultWidth", 80), 20, 400),
    defaultHeight: clamp(config.get<number>("defaultHeight", 20), 5, 200),
  };
}
