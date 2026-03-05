import { CanvasEditor } from "./canvas/CanvasEditor";
import { DEFAULT_DRAW_STYLE, resolveDrawStyleFromShapes, rebuildDefaultDrawStyle } from "./canvas/drawStyle";
import { reviveShapes, RectShape, EllipseShape, ArrowShape, TextShape, TableShape, ImageShape, applyCustomDefaults, shapeDefaults } from "./shared";
import type {
  ToolType,
  DiagramData,
  Shape,
  ShapeJSON,
  DiagramTemplateSummary,
  WebviewToExtMessage,
  ExtToWebviewMessage,
} from "./shared";

// VS Code webview API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function postMessage(msg: WebviewToExtMessage): void {
  vscode.postMessage(msg);
}

function buildSvgContent(shapes: Shape[], style: "plain" | "sketch" | "pencil", width: number, height: number): string {
  return shapesToSvgString(shapes, width, height, style);
}

interface WebviewState {
  shapes: ShapeJSON[];
}

let screenshotPasteEnabled = true;
let screenshotPasteMaxWidth = 1024;

/** shapeDefaults 更新後に DrawStyle を再構築する */
function rebuildDrawStyle(): void {
  rebuildDefaultDrawStyle();
}

function saveState(shapes: Shape[]): void {
  // Shape class instances are JSON-serializable (enumerable properties)
  vscode.setState({ shapes: JSON.parse(JSON.stringify(shapes)) } satisfies WebviewState);
}

function restoreState(): Shape[] | undefined {
  const state = vscode.getState() as WebviewState | undefined;
  if (!state?.shapes) { return undefined; }
  return reviveShapes(state.shapes);
}

// Initialize canvas editor
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const editor = new CanvasEditor(canvas);

// Restore canvas from persisted state (supports webview hide/show without retainContextWhenHidden)
const restored = restoreState();
if (restored) {
  editor.setShapes(restored);
}

// Persist canvas state on every mutation
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

// Sync toolbar when editor auto-switches tool (e.g. after shape creation)
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

// Keyboard shortcuts for tools (v for select only; shape insertion is now handled by CanvasEditor)
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) { return; }
  if (e.key.toLowerCase() === "v") {
    toolButtons.forEach((b) => b.classList.remove("active"));
    document.querySelector<HTMLButtonElement>(`button[data-tool="select"]`)?.classList.add("active");
    editor.setTool("select");
  }
});

function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable;
}

const vimBarStyle = document.createElement("style");
vimBarStyle.textContent = `
  #vim-command-bar {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 100;
    display: none;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--vscode-focusBorder, #007acc);
    border-radius: 4px;
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editorWidget-foreground, var(--vscode-editor-foreground));
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }
  #vim-command-bar.visible { display: flex; }
  #vim-command-prefix { opacity: 0.9; }
  #vim-command-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    color: inherit;
    border: none;
    outline: none;
    font: inherit;
  }
`;
document.head.appendChild(vimBarStyle);

const vimBar = document.createElement("div");
vimBar.id = "vim-command-bar";
vimBar.innerHTML = `<span id="vim-command-prefix">:</span><input id="vim-command-input" type="text" autocomplete="off" spellcheck="false" aria-label="Vim command">`;
document.body.appendChild(vimBar);
const vimCommandInput = document.getElementById("vim-command-input") as HTMLInputElement;

function closeVimCommandBar(clear = true): void {
  vimBar.classList.remove("visible");
  if (clear) {
    vimCommandInput.value = "";
  }
  (canvas as HTMLCanvasElement).focus();
}

function openVimCommandBar(): void {
  vimBar.classList.add("visible");
  vimCommandInput.value = "";
  vimCommandInput.focus();
}

function sendSave(closeAfterSave: boolean): void {
  const shapes = editor.getShapes();
  const { width, height } = editor.getCanvasSize();
  const svgContent = buildSvgContent(shapes, editor.renderStyle, width, height);
  if (closeAfterSave) {
    postMessage({ command: "saveAndClose", svgContent });
    return;
  }
  postMessage({ command: "save", svgContent });
}

function runVimCommand(commandText: string): void {
  const normalized = commandText.trim().toLowerCase();
  switch (normalized) {
    case "q":
      postMessage({ command: "close" });
      closeVimCommandBar();
      return;
    case "q!":
      postMessage({ command: "closeWithoutSave" });
      closeVimCommandBar();
      return;
    case "w":
      sendSave(false);
      closeVimCommandBar();
      return;
    case "wq":
      sendSave(true);
      closeVimCommandBar();
      return;
    default:
      vimCommandInput.select();
      return;
  }
}

vimCommandInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeVimCommandBar();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    runVimCommand(vimCommandInput.value);
  }
});

window.addEventListener("keydown", (e) => {
  if (e.isComposing) { return; }
  if (e.key === "Escape" && vimBar.classList.contains("visible")) {
    e.preventDefault();
    closeVimCommandBar();
    return;
  }
  if (e.key === ":" && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) {
    e.preventDefault();
    openVimCommandBar();
  }
});

window.addEventListener("paste", async (e) => {
  if (!screenshotPasteEnabled) { return; }
  const items = e.clipboardData?.items;
  if (!items || items.length === 0) { return; }

  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (!file) { continue; }
      e.preventDefault();
      const dataUrl = await blobToDataUrl(file);
      await editor.insertImageDataUrl(dataUrl, screenshotPasteMaxWidth);
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

// Style controls
const strokeInput = document.getElementById("stroke-color") as HTMLInputElement;
const fillInput = document.getElementById("fill-color") as HTMLInputElement;
const lineWidthInput = document.getElementById("line-width") as HTMLInputElement;
const cornerRadiusInput = document.getElementById("corner-radius") as HTMLInputElement;
const borderlessInput = document.getElementById("borderless") as HTMLInputElement;
const fontColorInput = document.getElementById("font-color") as HTMLInputElement;
const fontSizeInput = document.getElementById("font-size") as HTMLInputElement;
const fontFamilySelect = document.getElementById("font-family") as HTMLSelectElement;
const labelAlignHSelect = document.getElementById("label-align-h") as HTMLSelectElement;
const labelAlignVSelect = document.getElementById("label-align-v") as HTMLSelectElement;
let lineWidthBeforeBorderless = Math.max(1, parseInt(lineWidthInput.value, 10) || DEFAULT_DRAW_STYLE.lineWidth);
let refreshColorPalette = () => {};

function normalizeColorForPicker(value: string, fallback: string): string {
  const v = value.trim();
  const isHex = /^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v);
  return isHex ? v : fallback;
}

function applyStyleToControlsAndEditor(style: { stroke: string; fill: string; lineWidth: number; cornerRadius?: number; fontSize?: number; fontFamily?: string; fontColor?: string; labelAlignH?: "left" | "center" | "right"; labelAlignV?: "top" | "middle" | "bottom" }): void {
  const stroke = normalizeColorForPicker(style.stroke, DEFAULT_DRAW_STYLE.stroke);
  const fill = normalizeColorForPicker(style.fill, DEFAULT_DRAW_STYLE.fill);
  const width = Math.max(0, Math.round(style.lineWidth));
  const cornerRadius = Math.max(0, Math.round(style.cornerRadius ?? DEFAULT_DRAW_STYLE.cornerRadius));
  const fontSize = style.fontSize ?? DEFAULT_DRAW_STYLE.fontSize;
  const fontFamily = style.fontFamily ?? DEFAULT_DRAW_STYLE.fontFamily;
  const fontColor = normalizeColorForPicker(style.fontColor ?? DEFAULT_DRAW_STYLE.fontColor, DEFAULT_DRAW_STYLE.fontColor);
  const labelAlignH = style.labelAlignH ?? DEFAULT_DRAW_STYLE.labelAlignH;
  const labelAlignV = style.labelAlignV ?? DEFAULT_DRAW_STYLE.labelAlignV;

  strokeInput.value = stroke;
  fillInput.value = fill;
  lineWidthInput.value = String(width);
  cornerRadiusInput.value = String(cornerRadius);
  fontColorInput.value = fontColor;
  fontSizeInput.value = String(fontSize);
  fontFamilySelect.value = fontFamily;
  labelAlignHSelect.value = labelAlignH;
  labelAlignVSelect.value = labelAlignV;

  const borderless = width === 0;
  borderlessInput.checked = borderless;
  lineWidthInput.disabled = borderless;
  if (!borderless) {
    lineWidthBeforeBorderless = Math.max(1, width);
  }

  editor.setCurrentStyle({ stroke, fill, lineWidth: width, cornerRadius, fontSize, fontFamily, fontColor, labelAlignH, labelAlignV });
  refreshColorPalette();
}

function setupColorPalette(): void {
  const toggleBtn = document.getElementById("palette-toggle") as HTMLElement | null;
  const paletteBlock = document.getElementById("palette-block") as HTMLElement | null;
  const strokePalette = document.getElementById("palette-stroke") as HTMLElement | null;
  const fillPalette = document.getElementById("palette-fill") as HTMLElement | null;
  if (!toggleBtn || !paletteBlock || !strokePalette || !fillPalette) { return; }

  toggleBtn.addEventListener("click", () => {
    paletteBlock.classList.toggle("expanded");
  });

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
    const strokeBtn = makeSwatch(color, (hex) => {
      strokeInput.value = hex;
      applyStrokeStyle();
      refreshColorPalette();
    });
    strokeButtons.push(strokeBtn);
    strokePalette.appendChild(strokeBtn);

    const fillBtn = makeSwatch(color, (hex) => {
      fillInput.value = hex;
      editor.setStyle({ fill: hex });
      refreshColorPalette();
    });
    fillButtons.push(fillBtn);
    fillPalette.appendChild(fillBtn);
  }

  refreshColorPalette = () => {
    const stroke = strokeInput.value.toLowerCase();
    const fill = fillInput.value.toLowerCase();
    for (const b of strokeButtons) {
      b.classList.toggle("active", b.dataset.color === stroke);
    }
    for (const b of fillButtons) {
      b.classList.toggle("active", b.dataset.color === fill);
    }
  };

  refreshColorPalette();
}

const applyStrokeStyle = (): void => {
  editor.setStyle({ stroke: strokeInput.value });
};

strokeInput.addEventListener("input", () => applyStrokeStyle());
fillInput.addEventListener("input", () => {
  editor.setStyle({ fill: fillInput.value });
  refreshColorPalette();
});
lineWidthInput.addEventListener("input", () => {
  const next = Math.max(0, parseInt(lineWidthInput.value, 10) || 0);
  if (!borderlessInput.checked && next > 0) {
    lineWidthBeforeBorderless = next;
  }
  editor.setStyle({ lineWidth: next });
});
cornerRadiusInput.addEventListener("input", () => {
  const next = Math.max(0, parseInt(cornerRadiusInput.value, 10) || 0);
  editor.setStyle({ cornerRadius: next });
});
borderlessInput.addEventListener("change", () => {
  if (borderlessInput.checked) {
    const current = Math.max(0, parseInt(lineWidthInput.value, 10) || 0);
    if (current > 0) {
      lineWidthBeforeBorderless = current;
    }
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
fontColorInput.addEventListener("input", () => {
  editor.setStyle({ fontColor: fontColorInput.value });
});
fontSizeInput.addEventListener("input", () => {
  const next = Math.max(6, parseInt(fontSizeInput.value, 10) || DEFAULT_DRAW_STYLE.fontSize);
  editor.setStyle({ fontSize: next });
});
fontFamilySelect.addEventListener("change", () => {
  editor.setStyle({ fontFamily: fontFamilySelect.value });
});
labelAlignHSelect.addEventListener("change", () => {
  editor.setStyle({ labelAlignH: labelAlignHSelect.value as "left" | "center" | "right" });
});
labelAlignVSelect.addEventListener("change", () => {
  editor.setStyle({ labelAlignV: labelAlignVSelect.value as "top" | "middle" | "bottom" });
});

setupColorPalette();

// Align editor style with initial controls (important for new diagrams).
applyStyleToControlsAndEditor({
  stroke: strokeInput.value,
  fill: fillInput.value,
  lineWidth: parseInt(lineWidthInput.value, 10) || DEFAULT_DRAW_STYLE.lineWidth,
  cornerRadius: parseInt(cornerRadiusInput.value, 10) || DEFAULT_DRAW_STYLE.cornerRadius,
  labelAlignH: labelAlignHSelect.value as "left" | "center" | "right",
  labelAlignV: labelAlignVSelect.value as "top" | "middle" | "bottom",
});

// Action buttons
document.getElementById("btn-undo")!.addEventListener("click", () => editor.undo());
document.getElementById("btn-redo")!.addEventListener("click", () => editor.redo());
document.getElementById("btn-group")!.addEventListener("click", () => editor.groupSelected());
document.getElementById("btn-ungroup")!.addEventListener("click", () => editor.ungroupSelected());

// Style cycle button
const STYLE_LABELS: Record<string, string> = { plain: "🖊 Style: Plain", sketch: "✏ Style: Sketch", pencil: "✎ Style: Pencil" };
const btnStyle = document.getElementById("btn-style") as HTMLButtonElement | null;
function syncStyleButton(): void {
  if (btnStyle) {
    btnStyle.textContent = STYLE_LABELS[editor.renderStyle] ?? STYLE_LABELS.plain;
    btnStyle.classList.toggle("active", editor.renderStyle !== "plain");
  }
}
btnStyle?.addEventListener("click", () => {
  editor.cycleRenderStyle();
  syncStyleButton();
});

// Keyboard shortcut: s for style cycling (handled in CanvasEditor, sync button via callback)
editor.setOnStyleCycled(() => syncStyleButton());

document.getElementById("btn-save")!.addEventListener("click", () => {
  sendSave(false);
});

const templateNameInput = document.getElementById("template-name") as HTMLInputElement;
const templatePanel = document.getElementById("template-panel") as HTMLElement;
const templateList = document.getElementById("template-list") as HTMLElement;
const btnSaveTemplate = document.getElementById("btn-save-template") as HTMLButtonElement;
const btnSaveTemplateSvg = document.getElementById("btn-save-template-svg") as HTMLButtonElement;
const btnToggleTemplates = document.getElementById("btn-toggle-templates") as HTMLButtonElement;

let templates: DiagramTemplateSummary[] = [];

btnSaveTemplate.addEventListener("click", () => {
  const name = templateNameInput.value.trim();
  const shapes = editor.getShapes();
  if (!name || shapes.length === 0) {
    return;
  }
  postMessage({ command: "saveTemplate", name, shapes: JSON.parse(JSON.stringify(shapes)) as ShapeJSON[] });
});

btnSaveTemplateSvg.addEventListener("click", () => {
  const name = templateNameInput.value.trim();
  const shapes = editor.getShapes();
  if (!name || shapes.length === 0) {
    return;
  }
  const { width, height } = editor.getCanvasSize();
  const svgContent = shapesToSvgString(shapes, width, height, editor.renderStyle);
  postMessage({ command: "saveTemplateSvg", name, svgContent });
});

btnToggleTemplates.addEventListener("click", () => {
  templatePanel.classList.toggle("open");
  if (templatePanel.classList.contains("open")) {
    postMessage({ command: "listTemplates" });
  }
});

// --- Extension messages ---
window.addEventListener("message", (event) => {
  const msg = event.data as ExtToWebviewMessage;
  switch (msg.command) {
    case "init":
      screenshotPasteEnabled = msg.settings?.screenshotPasteEnabled ?? true;
      screenshotPasteMaxWidth = Math.max(128, msg.settings?.screenshotPasteMaxWidth ?? 1024);
      // カスタム図形デフォルトを適用
      if (msg.settings?.shapeDefaults) {
        applyCustomDefaults(msg.settings.shapeDefaults);
        rebuildDrawStyle();
      }
      if (msg.svgContent) {
        const data = parseDiagramJson(msg.svgContent);
        if (data) {
          editor.setShapes(data.shapes);
          applyStyleToControlsAndEditor(msg.settings?.defaultStyle ?? resolveDrawStyleFromShapes(data.shapes));
          saveState(data.shapes);
        }
      } else {
        editor.setShapes([]);
        applyStyleToControlsAndEditor(msg.settings?.defaultStyle ?? DEFAULT_DRAW_STYLE);
        saveState([]);
      }
      break;
    case "load":
      editor.setShapes(reviveShapes(msg.shapes));
      applyStyleToControlsAndEditor(resolveDrawStyleFromShapes(editor.getShapes()));
      saveState(editor.getShapes());
      break;
    case "templatesList":
      templates = msg.templates;
      renderTemplateList(templates);
      break;
    case "templatePayload":
      editor.insertShapes(reviveShapes(msg.shapes));
      saveState(editor.getShapes());
      break;
    case "templateSaved":
      templateNameInput.value = "";
      break;
    case "templateDeleted":
      templates = templates.filter((t) => t.id !== msg.templateId);
      renderTemplateList(templates);
      break;
    case "error":
      console.warn("Template error:", msg.message);
      break;
  }
});

// Notify extension we're ready
postMessage({ command: "ready" });

function renderTemplateList(items: DiagramTemplateSummary[]): void {
  if (items.length === 0) {
    templateList.innerHTML = `<div class="template-meta">No templates yet.</div>`;
    return;
  }

  const cards: string[] = [];
  for (const item of items) {
    const previewSrc = `data:image/svg+xml;utf8,${encodeURIComponent(item.thumbnailSvg)}`;
    cards.push(
      `<article class="template-item" data-id="${item.id}">`,
      `  <div class="template-title">${escapeHtml(item.name)}</div>`,
      `  <div class="template-meta">${item.shapeCount} shapes</div>`,
      `  <img class="template-preview" src="${previewSrc}" alt="${escapeHtml(item.name)} preview">`,
      "  <div class=\"template-actions\">",
      `    <button data-action="insert" data-id="${item.id}">Insert</button>`,
      `    <button data-action="delete" data-id="${item.id}">Delete</button>`,
      "  </div>",
      "</article>",
    );
  }
  templateList.innerHTML = cards.join("\n");

  for (const btn of Array.from(templateList.querySelectorAll<HTMLButtonElement>("button[data-action]"))) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (!id || !action) {
        return;
      }
      if (action === "insert") {
        postMessage({ command: "applyTemplate", templateId: id });
      }
      if (action === "delete") {
        postMessage({ command: "deleteTemplate", templateId: id });
      }
    });
  }
}

// --- SVG generation (client-side for save) ---

// ── Sketch SVG helpers (mirrored from svgExporter) ──────────────
function _skRand(seed: number): () => number {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}
function _skSeed(id: string): number {
  let h = 0x12345678;
  for (let i = 0; i < id.length; i++) { h = (Math.imul(h ^ id.charCodeAt(i), 0x9e3779b9)) >>> 0; }
  return h;
}
function _sv(v: number): string { return v.toFixed(2); }
function _skSeg(x1: number, y1: number, x2: number, y2: number, rand: () => number): string {
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
  const nx = len > 0.1 ? -dy / len : 0, ny = len > 0.1 ? dx / len : 0;
  const r = () => rand() - 0.5, mag = Math.min(3, len * 0.015 + 1);
  const cpx = (x1 + x2) / 2 + nx * r() * mag * 2 + r() * mag;
  const cpy = (y1 + y2) / 2 + ny * r() * mag * 2 + r() * mag;
  return `M ${_sv(x1 + r() * 1.2)} ${_sv(y1 + r() * 1.2)} Q ${_sv(cpx)} ${_sv(cpy)} ${_sv(x2 + r() * 1.2)} ${_sv(y2 + r() * 1.2)}`;
}
function _skRect(x: number, y: number, w: number, h: number, rand: () => number): string {
  const ov = () => (rand() - 0.5) * 2.5;
  return [
    _skSeg(x + ov(), y + ov(), x + w + ov(), y + ov(), rand),
    _skSeg(x + w + ov(), y + ov(), x + w + ov(), y + h + ov(), rand),
    _skSeg(x + w + ov(), y + h + ov(), x + ov(), y + h + ov(), rand),
    _skSeg(x + ov(), y + h + ov(), x + ov(), y + ov(), rand),
  ].join(" ");
}
function _skEllipse(cx: number, cy: number, rx: number, ry: number, rand: () => number): string {
  const segs = Math.max(20, Math.round(Math.PI * (rx + ry) * 0.5));
  const tStart = (rand() - 0.5) * 0.3;
  const pts: string[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = tStart + (i / segs) * (Math.PI * 2 + 0.12);
    const wobble = 1 + (rand() - 0.5) * 0.05;
    const px = cx + Math.cos(t) * rx * wobble, py = cy + Math.sin(t) * ry * wobble;
    pts.push(i === 0 ? `M ${_sv(px)} ${_sv(py)}` : `L ${_sv(px)} ${_sv(py)}`);
  }
  return pts.join(" ");
}
// ────────────────────────────────────────────────────────────────

function resolveSvgLabelPosition(
  shape: RectShape | EllipseShape | ArrowShape,
  defaultX: number,
  defaultY: number,
  fontSize: number,
): { x: number; y: number; anchor: "start" | "middle" | "end"; baseline: "hanging" | "central" | "text-after-edge" } {
  const bounds = shape.getBounds();
  const pad = 8;
  const h = shape.labelAlignH ?? "center";
  const v = shape.labelAlignV ?? "middle";
  let x = defaultX;
  let y = defaultY;
  if (h === "left") {
    x = bounds.minX + pad;
  } else if (h === "right") {
    x = bounds.maxX - pad;
  }
  if (v === "top") {
    y = bounds.minY + pad + fontSize / 2;
  } else if (v === "bottom") {
    y = bounds.maxY - pad - fontSize / 2;
  }
  return {
    x,
    y,
    anchor: h === "left" ? "start" : h === "right" ? "end" : "middle",
    baseline: v === "top" ? "hanging" : v === "bottom" ? "text-after-edge" : "central",
  };
}

function shapesToSvgString(shapes: Shape[], width: number, height: number, style: "plain" | "sketch" | "pencil" = "plain"): string {
  const sketchy = style !== "plain";
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
      const radius = Math.max(0, Math.min(shape.cornerRadius ?? 0, Math.min(shape.width, shape.height) / 2));
      const radiusAttr = radius > 0 ? ` rx="${radius}" ry="${radius}"` : "";
      if (sketchy) {
        const rand = _skRand(_skSeed(shape.id));
        if (shape.fill !== "none" && shape.fill !== "transparent") {
          lines.push(`  <rect data-shape-id="${shape.id}" fill="${shape.fill}" stroke="none" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"${radiusAttr}/>`);
        }
        if (shape.lineWidth > 0 && shape.stroke !== "none" && shape.stroke !== "transparent" && radius === 0) {
          const d = _skRect(shape.x, shape.y, shape.width, shape.height, rand);
          lines.push(`  <path data-shape-id="${shape.id}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}" d="${d}"/>`);
        } else if (shape.lineWidth > 0 && shape.stroke !== "none" && shape.stroke !== "transparent" && radius > 0) {
          lines.push(`  <rect data-shape-id="${shape.id}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"${radiusAttr}/>`);
        }
      } else {
        lines.push(`  <rect ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"${radiusAttr}/>`);
      }
      if (shape.label) {
        const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
        const ff = shape.labelFontFamily ?? shapeDefaults.fontFamily;
        const fc = shape.labelFontColor ?? shape.stroke;
        const pos = resolveSvgLabelPosition(shape, shape.x + shape.width / 2, shape.y + shape.height / 2, fs);
        const esc = shape.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`  <text x="${pos.x}" y="${pos.y}" font-size="${fs}" font-family="${ff}" fill="${fc}" text-anchor="${pos.anchor}" dominant-baseline="${pos.baseline}">${esc}</text>`);
      }
    } else if (shape instanceof EllipseShape) {
      if (sketchy) {
        const rand = _skRand(_skSeed(shape.id));
        if (shape.fill !== "none" && shape.fill !== "transparent") {
          lines.push(`  <ellipse data-shape-id="${shape.id}" fill="${shape.fill}" stroke="none" cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"/>`);
        }
        if (shape.lineWidth > 0 && shape.stroke !== "none" && shape.stroke !== "transparent") {
          const d = _skEllipse(shape.cx, shape.cy, Math.max(shape.rx, 0), Math.max(shape.ry, 0), rand);
          lines.push(`  <path data-shape-id="${shape.id}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}" d="${d}"/>`);
        }
      } else {
        lines.push(`  <ellipse ${common} cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"/>`);
      }
      if (shape.label) {
        const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
        const ff = shape.labelFontFamily ?? shapeDefaults.fontFamily;
        const fc = shape.labelFontColor ?? shape.stroke;
        const pos = resolveSvgLabelPosition(shape, shape.cx, shape.cy, fs);
        const esc = shape.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`  <text x="${pos.x}" y="${pos.y}" font-size="${fs}" font-family="${ff}" fill="${fc}" text-anchor="${pos.anchor}" dominant-baseline="${pos.baseline}">${esc}</text>`);
      }
    } else if (shape instanceof ArrowShape) {
      if (sketchy) {
        const rand = _skRand(_skSeed(shape.id));
        const r = () => rand() - 0.5;
        const shaftD = _skSeg(shape.x1, shape.y1, shape.x2, shape.y2, rand);
        lines.push(`  <path data-shape-id="${shape.id}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}" d="${shaftD}"/>`);
        const headLen = 12;
        const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
        const ex = shape.x2 + r() * 1.0, ey = shape.y2 + r() * 1.0;
        const hx1 = shape.x2 - headLen * Math.cos(angle - Math.PI / 6) + r() * 1.5;
        const hy1 = shape.y2 - headLen * Math.sin(angle - Math.PI / 6) + r() * 1.5;
        const hx2 = shape.x2 - headLen * Math.cos(angle + Math.PI / 6) + r() * 1.5;
        const hy2 = shape.y2 - headLen * Math.sin(angle + Math.PI / 6) + r() * 1.5;
        lines.push(`  <polygon data-shape-id="${shape.id}" fill="${shape.stroke}" stroke="none" points="${_sv(ex)},${_sv(ey)} ${_sv(hx1)},${_sv(hy1)} ${_sv(hx2)},${_sv(hy2)}"/>`);
      } else {
        lines.push(`  <line ${common} x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" marker-end="url(#arrowhead)" style="color:${shape.stroke}"/>`);
      }
      if (shape.label) {
        const lx = (shape.x1 + shape.x2) / 2;
        const ly = (shape.y1 + shape.y2) / 2 - 10;
        const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
        const ff = shape.labelFontFamily ?? shapeDefaults.fontFamily;
        const fc = shape.labelFontColor ?? shape.stroke;
        const pos = resolveSvgLabelPosition(shape, lx, ly, fs);
        const esc = shape.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`  <text x="${pos.x}" y="${pos.y}" font-size="${fs}" font-family="${ff}" fill="${fc}" text-anchor="${pos.anchor}" dominant-baseline="${pos.baseline}">${esc}</text>`);
      }
    } else if (shape instanceof TextShape) {
      const escaped = shape.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      lines.push(`  <text ${common} x="${shape.x}" y="${shape.y}" font-size="${shape.fontSize}" font-family="${shapeDefaults.fontFamily}">${escaped}</text>`);
    } else if (shape instanceof ImageShape) {
      const href = shape.dataUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
      lines.push(`  <image ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" href="${href}" preserveAspectRatio="none"/>`);
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
            const esc = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            lines.push(`    <text x="${tx + c * colW + 6}" y="${ty + r * rowH + rowH / 2}" font-size="${fontSize}" font-family="${shapeDefaults.fontFamily}" fill="${shape.stroke}" dominant-baseline="central">${esc}</text>`);
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
