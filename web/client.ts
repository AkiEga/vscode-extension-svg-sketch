/**
 * web/client.ts — ブラウザ用 SVG Sketch クライアント
 *
 * webview/main.ts の Web スタンドアロン版。
 * VS Code API の代わりに HTTP API + localStorage を使用。
 */

import { CanvasEditor } from "../webview/canvas/CanvasEditor";
import { DEFAULT_DRAW_STYLE, resolveDrawStyleFromShapes } from "../webview/canvas/drawStyle";
import { reviveShapes, RectShape, EllipseShape, ArrowShape, TextShape, TableShape, ImageShape, shapeDefaults } from "../webview/shared";
import type {
  ToolType,
  DiagramData,
  Shape,
  ShapeJSON,
} from "../webview/shared";

declare global {
  interface Window {
    __SVG_SKETCH_WEB__?: boolean;
    __SVG_SKETCH_INITIAL_SVG__?: string;
  }
}

// --- State persistence via localStorage ---
function saveState(shapes: Shape[]): void {
  try {
    localStorage.setItem("svg-sketch-state", JSON.stringify(shapes));
  } catch { /* quota exceeded — ignore */ }
}

function restoreState(): Shape[] | undefined {
  const raw = localStorage.getItem("svg-sketch-state");
  if (!raw) { return undefined; }
  try {
    return reviveShapes(JSON.parse(raw) as ShapeJSON[]);
  } catch {
    return undefined;
  }
}

// --- Initialize canvas editor ---
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const editor = new CanvasEditor(canvas);
const statusText = document.getElementById("status-text") as HTMLElement | null;

function setStatus(text: string): void {
  if (statusText) { statusText.textContent = text; }
}

// Restore from initial SVG or localStorage
const initialSvg = window.__SVG_SKETCH_INITIAL_SVG__ ?? "";
if (initialSvg) {
  const data = parseDiagramJson(initialSvg);
  if (data) {
    editor.setShapes(data.shapes);
    saveState(data.shapes);
    setStatus(`Loaded ${data.shapes.length} shapes`);
  }
} else {
  const restored = restoreState();
  if (restored) {
    editor.setShapes(restored);
    setStatus(`Restored ${restored.length} shapes`);
  }
}

editor.setOnChange(() => saveState(editor.getShapes()));

// --- Table editing toolbar ---
const tableToolbar = document.getElementById("table-toolbar") as HTMLElement;
editor.setOnSelectionChange((ids) => {
  if (ids.size === 0) {
    tableToolbar.style.visibility = "hidden";
    return;
  }
  const shape = editor.getSelectedShape();
  tableToolbar.style.visibility = shape?.type === "table" ? "visible" : "hidden";
});

document.getElementById("btn-add-row")!.addEventListener("click", () => editor.addTableRow());
document.getElementById("btn-del-row")!.addEventListener("click", () => editor.deleteTableRow());
document.getElementById("btn-add-col")!.addEventListener("click", () => editor.addTableColumn());
document.getElementById("btn-del-col")!.addEventListener("click", () => editor.deleteTableColumn());

// --- Toolbar bindings ---
const toolButtons = document.querySelectorAll<HTMLButtonElement>("#toolbar button[data-tool]");

editor.setOnToolChange((tool) => {
  toolButtons.forEach((b) => b.classList.remove("active"));
  document.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.classList.add("active");
});
toolButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    toolButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    editor.setTool(btn.dataset.tool as ToolType);
  });
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) { return; }
  if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) {
    const snapBtn = document.getElementById("btn-snap") as HTMLButtonElement | null;
    const on = editor.toggleSnap();
    if (snapBtn) { snapBtn.classList.toggle("active", on); }
    return;
  }
  const keyMap: Record<string, ToolType> = {
    v: "select", r: "rect", e: "ellipse", a: "arrow", t: "text", g: "table",
  };
  const tool = keyMap[e.key.toLowerCase()];
  if (tool) {
    toolButtons.forEach((b) => b.classList.remove("active"));
    document.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.classList.add("active");
    editor.setTool(tool);
  }

  // Ctrl+Z / Ctrl+Y
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    editor.undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "y") {
    e.preventDefault();
    editor.redo();
  }
  if (e.key === "Delete") {
    editor.deleteSelected();
  }
});

// Image paste
window.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items;
  if (!items) { return; }
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (!file) { continue; }
      e.preventDefault();
      const dataUrl = await blobToDataUrl(file);
      await editor.insertImageDataUrl(dataUrl, 1024);
      saveState(editor.getShapes());
      return;
    }
  }
});

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read pasted image."));
    reader.readAsDataURL(blob);
  });
}

// --- Style controls ---
const strokeInput = document.getElementById("stroke-color") as HTMLInputElement;
const fillInput = document.getElementById("fill-color") as HTMLInputElement;
const lineWidthInput = document.getElementById("line-width") as HTMLInputElement;
const borderlessInput = document.getElementById("borderless") as HTMLInputElement;
const fontColorInput = document.getElementById("font-color") as HTMLInputElement;
const fontSizeInput = document.getElementById("font-size") as HTMLInputElement;
const fontFamilySelect = document.getElementById("font-family") as HTMLSelectElement;
let lineWidthBeforeBorderless = Math.max(1, parseInt(lineWidthInput.value, 10) || DEFAULT_DRAW_STYLE.lineWidth);
let refreshColorPalette = () => {};

function normalizeColorForPicker(value: string, fallback: string): string {
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/i.test(v) || /^#[0-9a-fA-F]{3}$/i.test(v) ? v : fallback;
}

function applyStyleToControlsAndEditor(style: { stroke: string; fill: string; lineWidth: number; fontSize?: number; fontFamily?: string; fontColor?: string }): void {
  const stroke = normalizeColorForPicker(style.stroke, DEFAULT_DRAW_STYLE.stroke);
  const fill = normalizeColorForPicker(style.fill, DEFAULT_DRAW_STYLE.fill);
  const width = Math.max(0, Math.round(style.lineWidth));
  const fontSize = style.fontSize ?? DEFAULT_DRAW_STYLE.fontSize;
  const fontFamily = style.fontFamily ?? DEFAULT_DRAW_STYLE.fontFamily;
  const fontColor = normalizeColorForPicker(style.fontColor ?? DEFAULT_DRAW_STYLE.fontColor, DEFAULT_DRAW_STYLE.fontColor);

  strokeInput.value = stroke;
  fillInput.value = fill;
  lineWidthInput.value = String(width);
  fontColorInput.value = fontColor;
  fontSizeInput.value = String(fontSize);
  fontFamilySelect.value = fontFamily;

  const borderless = width === 0;
  borderlessInput.checked = borderless;
  lineWidthInput.disabled = borderless;
  if (!borderless) { lineWidthBeforeBorderless = Math.max(1, width); }

  editor.setCurrentStyle({ stroke, fill, lineWidth: width, fontSize, fontFamily, fontColor });
  refreshColorPalette();
}

function setupColorPalette(): void {
  const toggleBtn = document.getElementById("palette-toggle") as HTMLElement | null;
  const paletteBlock = document.getElementById("palette-block") as HTMLElement | null;
  const strokePalette = document.getElementById("palette-stroke") as HTMLElement | null;
  const fillPalette = document.getElementById("palette-fill") as HTMLElement | null;
  if (!toggleBtn || !paletteBlock || !strokePalette || !fillPalette) { return; }

  toggleBtn.addEventListener("click", () => { paletteBlock.classList.toggle("expanded"); });

  const strokeButtons: HTMLButtonElement[] = [];
  const fillButtons: HTMLButtonElement[] = [];

  const makeSwatch = (color: string, onPick: (hex: string) => void): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-swatch";
    btn.dataset.color = color.toLowerCase();
    btn.title = color;
    btn.style.background = color;
    btn.addEventListener("click", () => onPick(color));
    return btn;
  };

  for (const color of shapeDefaults.paletteColors) {
    const sb = makeSwatch(color, (hex) => { strokeInput.value = hex; applyStrokeStyle(); refreshColorPalette(); });
    strokeButtons.push(sb);
    strokePalette.appendChild(sb);
    const fb = makeSwatch(color, (hex) => { fillInput.value = hex; editor.setStyle({ fill: hex }); refreshColorPalette(); });
    fillButtons.push(fb);
    fillPalette.appendChild(fb);
  }

  refreshColorPalette = () => {
    const s = strokeInput.value.toLowerCase();
    const f = fillInput.value.toLowerCase();
    for (const b of strokeButtons) { b.classList.toggle("active", b.dataset.color === s); }
    for (const b of fillButtons) { b.classList.toggle("active", b.dataset.color === f); }
  };
  refreshColorPalette();
}

const applyStrokeStyle = (): void => { editor.setStyle({ stroke: strokeInput.value }); };

strokeInput.addEventListener("input", () => applyStrokeStyle());
fillInput.addEventListener("input", () => { editor.setStyle({ fill: fillInput.value }); refreshColorPalette(); });
lineWidthInput.addEventListener("input", () => {
  const next = Math.max(0, parseInt(lineWidthInput.value, 10) || 0);
  if (!borderlessInput.checked && next > 0) { lineWidthBeforeBorderless = next; }
  editor.setStyle({ lineWidth: next });
});
borderlessInput.addEventListener("change", () => {
  if (borderlessInput.checked) {
    const current = Math.max(0, parseInt(lineWidthInput.value, 10) || 0);
    if (current > 0) { lineWidthBeforeBorderless = current; }
    lineWidthInput.value = "0";
    lineWidthInput.disabled = true;
    editor.setStyle({ lineWidth: 0 });
    return;
  }
  const restore = Math.max(1, lineWidthBeforeBorderless || 2);
  lineWidthInput.value = String(restore);
  lineWidthInput.disabled = false;
  editor.setStyle({ lineWidth: restore, stroke: strokeInput.value });
});
fontColorInput.addEventListener("input", () => { editor.setStyle({ fontColor: fontColorInput.value }); });
fontSizeInput.addEventListener("input", () => {
  const next = Math.max(6, parseInt(fontSizeInput.value, 10) || DEFAULT_DRAW_STYLE.fontSize);
  editor.setStyle({ fontSize: next });
});
fontFamilySelect.addEventListener("change", () => { editor.setStyle({ fontFamily: fontFamilySelect.value }); });

setupColorPalette();
applyStyleToControlsAndEditor({
  stroke: strokeInput.value,
  fill: fillInput.value,
  lineWidth: parseInt(lineWidthInput.value, 10) || DEFAULT_DRAW_STYLE.lineWidth,
});

// --- Action buttons ---
document.getElementById("btn-undo")!.addEventListener("click", () => editor.undo());
document.getElementById("btn-redo")!.addEventListener("click", () => editor.redo());
document.getElementById("btn-delete")!.addEventListener("click", () => editor.deleteSelected());
document.getElementById("btn-edit-label")!.addEventListener("click", () => editor.editSelectedShapeLabel());
document.getElementById("btn-group")!.addEventListener("click", () => editor.groupSelected());
document.getElementById("btn-ungroup")!.addEventListener("click", () => editor.ungroupSelected());

const btnSnap = document.getElementById("btn-snap") as HTMLButtonElement | null;
btnSnap?.classList.toggle("active", editor.snapToGrid);
btnSnap?.addEventListener("click", () => {
  const on = editor.toggleSnap();
  btnSnap.classList.toggle("active", on);
});

// Save via HTTP
document.getElementById("btn-save")!.addEventListener("click", async () => {
  const shapes = editor.getShapes();
  const { width, height } = editor.getCanvasSize();
  const svgContent = shapesToSvgString(shapes, width, height);
  setStatus("Saving...");
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: svgContent,
    });
    const json = await res.json() as { ok: boolean; path?: string };
    setStatus(json.path ? `Saved: ${json.path}` : "Saved (no file specified)");
  } catch (err) {
    setStatus("Save failed");
    console.error(err);
  }
});

// Download as file
document.getElementById("btn-download")?.addEventListener("click", () => {
  const shapes = editor.getShapes();
  const { width, height } = editor.getCanvasSize();
  const svgContent = shapesToSvgString(shapes, width, height);
  const blob = new Blob([svgContent], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "diagram.svg";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Downloaded diagram.svg");
});

// --- SVG generation ---
function shapesToSvgString(shapes: Shape[], width: number, height: number): string {
  const diagramData: DiagramData = { version: 1, shapes };
  const dataAttr = JSON.stringify(diagramData).replace(/'/g, "&#39;");
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`,
    `  data-editor="svg-sketch"`,
    `  data-diagram='${dataAttr}'>`,
  );
  lines.push("  <defs>");
  lines.push(
    '    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">',
    '      <polygon points="0 0, 10 3.5, 0 7" fill="currentColor"/>',
    "    </marker>",
  );
  lines.push("  </defs>");

  for (const shape of shapes) {
    const common = `data-shape-id="${shape.id}" stroke="${shape.stroke}" fill="${shape.fill}" stroke-width="${shape.lineWidth}"`;
    if (shape instanceof RectShape) {
      lines.push(`  <rect ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"/>`);
      if (shape.label) {
        const lx = shape.x + shape.width / 2;
        const ly = shape.y + shape.height / 2;
        const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
        const esc = escapeXml(shape.label);
        lines.push(`  <text x="${lx}" y="${ly}" font-size="${fs}" font-family="${shapeDefaults.fontFamily}" fill="${shape.stroke}" text-anchor="middle" dominant-baseline="central">${esc}</text>`);
      }
    } else if (shape instanceof EllipseShape) {
      lines.push(`  <ellipse ${common} cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"/>`);
      if (shape.label) {
        const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
        lines.push(`  <text x="${shape.cx}" y="${shape.cy}" font-size="${fs}" font-family="${shapeDefaults.fontFamily}" fill="${shape.stroke}" text-anchor="middle" dominant-baseline="central">${escapeXml(shape.label)}</text>`);
      }
    } else if (shape instanceof ArrowShape) {
      lines.push(`  <line ${common} x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" marker-end="url(#arrowhead)" style="color:${shape.stroke}"/>`);
      if (shape.label) {
        const lx = (shape.x1 + shape.x2) / 2;
        const ly = (shape.y1 + shape.y2) / 2 - 10;
        const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
        lines.push(`  <text x="${lx}" y="${ly}" font-size="${fs}" font-family="${shapeDefaults.fontFamily}" fill="${shape.stroke}" text-anchor="middle" dominant-baseline="central">${escapeXml(shape.label)}</text>`);
      }
    } else if (shape instanceof TextShape) {
      lines.push(`  <text ${common} x="${shape.x}" y="${shape.y}" font-size="${shape.fontSize}" font-family="${shapeDefaults.fontFamily}">${escapeXml(shape.text)}</text>`);
    } else if (shape instanceof ImageShape) {
      lines.push(`  <image ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" href="${escapeXml(shape.dataUrl)}" preserveAspectRatio="none"/>`);
    } else if (shape instanceof TableShape) {
      const { x: tx, y: ty, width: tw, height: th, rows, cols, cells, fontSize } = shape;
      const colW = tw / cols;
      const rowH = th / rows;
      lines.push(`  <g ${common} data-table-rows="${rows}" data-table-cols="${cols}">`);
      lines.push(`    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}"/>`);
      lines.push(`    <rect x="${tx}" y="${ty}" width="${tw}" height="${rowH}" fill="${shapeDefaults.tableHeaderBg}" stroke="none"/>`);
      for (let r = 1; r < rows; r++) {
        lines.push(`    <line x1="${tx}" y1="${ty + r * rowH}" x2="${tx + tw}" y2="${ty + r * rowH}" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}"/>`);
      }
      for (let c = 1; c < cols; c++) {
        lines.push(`    <line x1="${tx + c * colW}" y1="${ty}" x2="${tx + c * colW}" y2="${ty + th}" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}"/>`);
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const t = cells[r]?.[c];
          if (t) {
            lines.push(`    <text x="${tx + c * colW + 6}" y="${ty + r * rowH + rowH / 2}" font-size="${fontSize}" font-family="${shapeDefaults.fontFamily}" fill="${shape.stroke}" dominant-baseline="central">${escapeXml(t)}</text>`);
          }
        }
      }
      lines.push("  </g>");
    }
  }
  lines.push("</svg>");
  return lines.join("\n");
}

function parseDiagramJson(svgContent: string): DiagramData | undefined {
  const match = svgContent.match(/data-diagram='([^']*)'/);
  if (!match) { return undefined; }
  try {
    const raw = match[1].replace(/&#39;/g, "'");
    const parsed = JSON.parse(raw) as { version: 1; shapes: ShapeJSON[] };
    return { version: parsed.version, shapes: reviveShapes(parsed.shapes) };
  } catch {
    return undefined;
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
