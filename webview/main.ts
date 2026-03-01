import { CanvasEditor } from "./canvas/CanvasEditor";
import { DEFAULT_DRAW_STYLE, resolveDrawStyleFromShapes } from "./canvas/drawStyle";
import { reviveShapes, RectShape, EllipseShape, ArrowShape, BubbleShape, TextShape, TableShape, ImageShape } from "./shared";
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

interface WebviewState {
  shapes: ShapeJSON[];
}

let screenshotPasteEnabled = true;
let screenshotPasteMaxWidth = 1024;

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

// Keyboard shortcuts for tools
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) { return; }
  // Snap toggle: S key
  if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) {
    const snapBtn = document.getElementById("btn-snap") as HTMLButtonElement | null;
    const on = editor.toggleSnap();
    if (snapBtn) { snapBtn.classList.toggle("active", on); }
    return;
  }
  const keyMap: Record<string, ToolType> = {
    v: "select", r: "rect", e: "ellipse", a: "arrow", t: "text", b: "bubble", g: "table",
  };
  const tool = keyMap[e.key.toLowerCase()];
  if (tool) {
    toolButtons.forEach((b) => b.classList.remove("active"));
    document.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.classList.add("active");
    editor.setTool(tool);
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
const borderlessInput = document.getElementById("borderless") as HTMLInputElement;
let lineWidthBeforeBorderless = Math.max(1, parseInt(lineWidthInput.value, 10) || DEFAULT_DRAW_STYLE.lineWidth);

function normalizeColorForPicker(value: string, fallback: string): string {
  const v = value.trim();
  const isHex = /^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v);
  return isHex ? v : fallback;
}

function applyStyleToControlsAndEditor(style: { stroke: string; fill: string; lineWidth: number }): void {
  const stroke = normalizeColorForPicker(style.stroke, DEFAULT_DRAW_STYLE.stroke);
  const fill = normalizeColorForPicker(style.fill, DEFAULT_DRAW_STYLE.fill);
  const width = Math.max(0, Math.round(style.lineWidth));

  strokeInput.value = stroke;
  fillInput.value = fill;
  lineWidthInput.value = String(width);

  const borderless = width === 0;
  borderlessInput.checked = borderless;
  lineWidthInput.disabled = borderless;
  if (!borderless) {
    lineWidthBeforeBorderless = Math.max(1, width);
  }

  editor.setCurrentStyle({ stroke, fill, lineWidth: width });
}

const applyStrokeStyle = (): void => {
  editor.setStyle({ stroke: strokeInput.value });
};

strokeInput.addEventListener("input", () => applyStrokeStyle());
fillInput.addEventListener("input", () => editor.setStyle({ fill: fillInput.value }));
lineWidthInput.addEventListener("input", () => {
  const next = Math.max(0, parseInt(lineWidthInput.value, 10) || 0);
  if (!borderlessInput.checked && next > 0) {
    lineWidthBeforeBorderless = next;
  }
  editor.setStyle({ lineWidth: next });
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

// Align editor style with initial controls (important for new diagrams).
applyStyleToControlsAndEditor({
  stroke: strokeInput.value,
  fill: fillInput.value,
  lineWidth: parseInt(lineWidthInput.value, 10) || DEFAULT_DRAW_STYLE.lineWidth,
});

// Action buttons
document.getElementById("btn-undo")!.addEventListener("click", () => editor.undo());
document.getElementById("btn-redo")!.addEventListener("click", () => editor.redo());
document.getElementById("btn-delete")!.addEventListener("click", () => editor.deleteSelected());
document.getElementById("btn-edit-label")!.addEventListener("click", () => editor.editSelectedShapeLabel());
document.getElementById("btn-group")!.addEventListener("click", () => editor.groupSelected());
document.getElementById("btn-ungroup")!.addEventListener("click", () => editor.ungroupSelected());

// Snap toggle
const btnSnap = document.getElementById("btn-snap") as HTMLButtonElement | null;
btnSnap?.classList.toggle("active", editor.snapToGrid);
btnSnap?.addEventListener("click", () => {
  const on = editor.toggleSnap();
  btnSnap.classList.toggle("active", on);
});

document.getElementById("btn-save")!.addEventListener("click", () => {
  const shapes = editor.getShapes();
  const { width, height } = editor.getCanvasSize();
  const svgContent = shapesToSvgString(shapes, width, height);
  postMessage({ command: "save", svgContent });
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
  const svgContent = shapesToSvgString(shapes, width, height);
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

  for (const btn of templateList.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
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
        const fs = shape.labelFontSize ?? 16;
        const esc = shape.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`  <text x="${lx}" y="${ly}" font-size="${fs}" font-family="sans-serif" fill="${shape.stroke}" text-anchor="middle" dominant-baseline="central">${esc}</text>`);
      }
    } else if (shape instanceof EllipseShape) {
      lines.push(`  <ellipse ${common} cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"/>`);
      if (shape.label) {
        const fs = shape.labelFontSize ?? 16;
        const esc = shape.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`  <text x="${shape.cx}" y="${shape.cy}" font-size="${fs}" font-family="sans-serif" fill="${shape.stroke}" text-anchor="middle" dominant-baseline="central">${esc}</text>`);
      }
    } else if (shape instanceof ArrowShape) {
      lines.push(`  <line ${common} x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" marker-end="url(#arrowhead)" style="color:${shape.stroke}"/>`);
      if (shape.label) {
        const lx = (shape.x1 + shape.x2) / 2;
        const ly = (shape.y1 + shape.y2) / 2 - 10;
        const fs = shape.labelFontSize ?? 16;
        const esc = shape.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`  <text x="${lx}" y="${ly}" font-size="${fs}" font-family="sans-serif" fill="${shape.stroke}" text-anchor="middle" dominant-baseline="central">${esc}</text>`);
      }
    } else if (shape instanceof BubbleShape) {
      const x = shape.x;
      const y = shape.y;
      const w = shape.width;
      const h = shape.height;
      const tailW = Math.min(24, w * 0.25);
      const tailH = Math.min(18, h * 0.25);
      const tailX = x + w * 0.35;
      const path = [
        `M ${x} ${y}`,
        `H ${x + w}`,
        `V ${y + h}`,
        `H ${tailX + tailW}`,
        `L ${tailX + tailW * 0.4} ${y + h + tailH}`,
        `L ${tailX} ${y + h}`,
        `H ${x}`,
        "Z",
      ].join(" ");
      lines.push(`  <path ${common} d="${path}"/>`);
      if (shape.label) {
        const lx = shape.x + shape.width / 2;
        const ly = shape.y + shape.height / 2;
        const fs = shape.labelFontSize ?? 16;
        const esc = shape.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`  <text x="${lx}" y="${ly}" font-size="${fs}" font-family="sans-serif" fill="${shape.stroke}" text-anchor="middle" dominant-baseline="central">${esc}</text>`);
      }
    } else if (shape instanceof TextShape) {
      const escaped = shape.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      lines.push(`  <text ${common} x="${shape.x}" y="${shape.y}" font-size="${shape.fontSize}" font-family="sans-serif">${escaped}</text>`);
    } else if (shape instanceof ImageShape) {
      const href = shape.dataUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
      lines.push(`  <image ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" href="${href}" preserveAspectRatio="none"/>`);
    } else if (shape instanceof TableShape) {
      const { x: tx, y: ty, width: tw, height: th, rows, cols, cells, fontSize } = shape;
      const colW = tw / cols;
      const rowH = th / rows;
      lines.push(`  <g ${common} data-table-rows="${rows}" data-table-cols="${cols}">`);
      lines.push(`    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}"/>`);
      lines.push(`    <rect x="${tx}" y="${ty}" width="${tw}" height="${rowH}" fill="#e5e7eb" stroke="none"/>`);
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
            lines.push(`    <text x="${tx + c * colW + 6}" y="${ty + r * rowH + rowH / 2}" font-size="${fontSize}" font-family="sans-serif" fill="${shape.stroke}" dominant-baseline="central">${esc}</text>`);
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
