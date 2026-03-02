import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { EditorSettings } from "./types";
import { shapeDefaults as shapeDefaultsObj, parseShapeDefaultsSvg, applyCustomDefaults } from "./shapeConfig";

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

  // カスタム SVG ファイルの読み込み（VS Code 設定のフォールバック値に反映するため先に処理）
  const customSvgPath = config.get<string>("shapeDefaultsSvgPath", "")?.trim();
  let customDefaults: EditorSettings["shapeDefaults"];
  if (customSvgPath) {
    const resolved = resolveCustomSvgPath(customSvgPath);
    if (resolved) {
      try {
        const svg = fs.readFileSync(resolved, "utf-8");
        const parsed = parseShapeDefaultsSvg(svg);
        applyCustomDefaults(parsed);
        customDefaults = parsed;
      } catch {
        // ファイル読み取りエラー時はバンドル済みデフォルトを使用
      }
    }
  }

  const stroke = normalizeHexColor(config.get<string>("defaultStroke", shapeDefaultsObj.stroke), shapeDefaultsObj.stroke);
  const fill = normalizeHexColor(config.get<string>("defaultFill", shapeDefaultsObj.fill), shapeDefaultsObj.fill);
  const lineWidth = clamp(config.get<number>("defaultLineWidth", shapeDefaultsObj.lineWidth), 0, 20);
  const screenshotPasteEnabled = config.get<boolean>("screenshotPasteEnabled", true);
  const screenshotPasteMaxWidth = clamp(config.get<number>("screenshotPasteMaxWidth", 1024), 128, 4096);

  return {
    defaultStyle: { stroke, fill, lineWidth },
    screenshotPasteEnabled,
    screenshotPasteMaxWidth,
    shapeDefaults: customDefaults,
  };
}

/** ワークスペース相対 or 絶対パスを解決する */
function resolveCustomSvgPath(rawPath: string): string | undefined {
  if (!rawPath) { return undefined; }
  if (path.isAbsolute(rawPath)) {
    return fs.existsSync(rawPath) ? rawPath : undefined;
  }
  // ワークスペースルートからの相対パス
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return undefined; }
  const resolved = path.join(folders[0].uri.fsPath, rawPath);
  return fs.existsSync(resolved) ? resolved : undefined;
}
