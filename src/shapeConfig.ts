// 図形のデフォルト設定を assets/shapeDefaults.svg から読み取るモジュール
// SVG ファイルの属性値を変更すると、エディタ全体のデフォルト設定が変わる。
// ユーザーが VS Code 設定で別の SVG ファイルを指定することもできる。

import defaultsSvg from "../assets/shapeDefaults.svg";

// --- ShapeDefaults 型 ---

/** 全図形デフォルト設定をまとめた型 */
export interface ShapeDefaults {
  stroke: string;
  fill: string;
  lineWidth: number;
  fontSize: number;
  fontFamily: string;
  fontColor: string;
  tableHeaderBg: string;
  paletteColors: readonly string[];
}

// --- SVG パースロジック ---

/** 指定 id を持つ要素から属性値を取得する */
function attrFrom(svg: string, id: string, name: string): string | undefined {
  const elRe = new RegExp(`id=["']${id}["'][^>]*>`, "s");
  const elMatch = svg.match(elRe);
  if (!elMatch) { return undefined; }
  const tag = elMatch[0];
  const attrRe = new RegExp(`${name}=["']([^"']*)["']`);
  const m = tag.match(attrRe);
  return m?.[1];
}

/** 指定 id を持つ要素から数値属性を取得する */
function numAttrFrom(svg: string, id: string, name: string, fallback: number): number {
  const v = attrFrom(svg, id, name);
  if (v === undefined) { return fallback; }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** #palette 内の全 rect の fill を取得する */
function parsePaletteColorsFrom(svg: string): string[] {
  const gMatch = svg.match(/<g\s+id=["']palette["'][^>]*>([\s\S]*?)<\/g>/);
  if (!gMatch) { return []; }
  const inner = gMatch[1];
  const fills: string[] = [];
  const re = /fill=["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    fills.push(m[1]);
  }
  return fills;
}

const FALLBACK_PALETTE: readonly string[] = [
  "#000000", "#ffffff", "#ef4444", "#f97316", "#f59e0b",
  "#22c55e", "#0ea5e9", "#3b82f6", "#6366f1", "#ec4899",
];

/** SVG 文字列をパースして ShapeDefaults を生成する */
export function parseShapeDefaultsSvg(svg: string): ShapeDefaults {
  const palette = parsePaletteColorsFrom(svg);
  return {
    stroke: attrFrom(svg, "default-shape", "stroke") ?? "#000000",
    fill: attrFrom(svg, "default-shape", "fill") ?? "#ffffff",
    lineWidth: numAttrFrom(svg, "default-shape", "stroke-width", 2),
    fontSize: numAttrFrom(svg, "default-text", "font-size", 16),
    fontFamily: attrFrom(svg, "default-text", "font-family") ?? "sans-serif",
    fontColor: attrFrom(svg, "default-text", "fill") ?? "#000000",
    tableHeaderBg: attrFrom(svg, "table-header", "fill") ?? "#e5e7eb",
    paletteColors: palette.length > 0 ? palette : FALLBACK_PALETTE,
  };
}

// --- ミュータブルなシングルトン設定 ---

/** バンドル済み SVG から初期化 */
const _defaults: ShapeDefaults = parseShapeDefaultsSvg(defaultsSvg);

/** 現在有効な設定を返す */
export function getShapeDefaults(): ShapeDefaults { return _defaults; }

/** カスタム設定で上書きする (extension/webview の init 時に呼ぶ) */
export function applyCustomDefaults(custom: ShapeDefaults): void {
  Object.assign(_defaults, custom);
}

// --- 後方互換のための個別エクスポート (ミュータブルオブジェクトのプロパティ参照) ---

export const shapeDefaults = _defaults;

/** @deprecated shapeDefaults.stroke を使うこと */
export const DEFAULT_STROKE: string = _defaults.stroke;
/** @deprecated shapeDefaults.fill を使うこと */
export const DEFAULT_FILL: string = _defaults.fill;
/** @deprecated shapeDefaults.lineWidth を使うこと */
export const DEFAULT_LINE_WIDTH: number = _defaults.lineWidth;
/** @deprecated shapeDefaults.fontSize を使うこと */
export const DEFAULT_FONT_SIZE: number = _defaults.fontSize;
/** @deprecated shapeDefaults.fontFamily を使うこと */
export const DEFAULT_FONT_FAMILY: string = _defaults.fontFamily;
/** @deprecated shapeDefaults.fontColor を使うこと */
export const DEFAULT_FONT_COLOR: string = _defaults.fontColor;
/** @deprecated shapeDefaults.tableHeaderBg を使うこと */
export const TABLE_HEADER_BG: string = _defaults.tableHeaderBg;
/** @deprecated shapeDefaults.paletteColors を使うこと */
export const PALETTE_COLORS: readonly string[] = _defaults.paletteColors;
