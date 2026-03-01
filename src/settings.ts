import * as vscode from "vscode";
import type { EditorSettings } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  if (!value) { return fallback; }
  const trimmed = value.trim();
  const isHex = /^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{3}$/.test(trimmed);
  return isHex ? trimmed : fallback;
}

export function getEditorSettings(): EditorSettings {
  const config = vscode.workspace.getConfiguration("svg-sketch");
  const stroke = normalizeHexColor(config.get<string>("defaultStroke", "#000000"), "#000000");
  const fill = normalizeHexColor(config.get<string>("defaultFill", "#ffffff"), "#ffffff");
  const lineWidth = clamp(config.get<number>("defaultLineWidth", 2), 0, 20);
  const screenshotPasteEnabled = config.get<boolean>("screenshotPasteEnabled", true);
  const screenshotPasteMaxWidth = clamp(config.get<number>("screenshotPasteMaxWidth", 1024), 128, 4096);

  return {
    defaultStyle: { stroke, fill, lineWidth },
    screenshotPasteEnabled,
    screenshotPasteMaxWidth,
  };
}
