import { CanvasEditor } from "./canvas/CanvasEditor";
import type { ToolType, DiagramData, Shape } from "./shared";

// VS Code webview API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// Initialize canvas editor
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const editor = new CanvasEditor(canvas);

// --- Toolbar bindings ---
const toolButtons = document.querySelectorAll<HTMLButtonElement>("#toolbar button[data-tool]");
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
  const keyMap: Record<string, ToolType> = {
    v: "select", r: "rect", e: "ellipse", a: "arrow", t: "text",
  };
  const tool = keyMap[e.key.toLowerCase()];
  if (tool) {
    toolButtons.forEach((b) => b.classList.remove("active"));
    document.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.classList.add("active");
    editor.setTool(tool);
  }
});

// Style controls
const strokeInput = document.getElementById("stroke-color") as HTMLInputElement;
const fillInput = document.getElementById("fill-color") as HTMLInputElement;
const lineWidthInput = document.getElementById("line-width") as HTMLInputElement;

strokeInput.addEventListener("input", () => editor.setStyle({ stroke: strokeInput.value }));
fillInput.addEventListener("input", () => editor.setStyle({ fill: fillInput.value }));
lineWidthInput.addEventListener("input", () => editor.setStyle({ lineWidth: parseInt(lineWidthInput.value, 10) }));

// Action buttons
document.getElementById("btn-undo")!.addEventListener("click", () => editor.undo());
document.getElementById("btn-redo")!.addEventListener("click", () => editor.redo());
document.getElementById("btn-delete")!.addEventListener("click", () => editor.deleteSelected());

document.getElementById("btn-save")!.addEventListener("click", () => {
  const shapes = editor.getShapes();
  const { width, height } = editor.getCanvasSize();
  const svgContent = shapesToSvgString(shapes, width, height);
  vscode.postMessage({ command: "save", svgContent });
});

// --- Extension messages ---
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.command) {
    case "init":
      if (msg.svgContent) {
        const data = parseDiagramJson(msg.svgContent);
        if (data) {
          editor.setShapes(data.shapes);
        }
      } else {
        editor.setShapes([]);
      }
      break;
    case "load":
      editor.setShapes(msg.shapes);
      break;
  }
});

// Notify extension we're ready
vscode.postMessage({ command: "ready" });

// --- SVG generation (client-side for save) ---
function shapesToSvgString(shapes: Shape[], width: number, height: number): string {
  const diagramData: DiagramData = { version: 1, shapes };
  const dataAttr = JSON.stringify(diagramData).replace(/'/g, "&#39;");
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`,
    `  data-editor="markdown-svg-sketch"`,
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
    switch (shape.type) {
      case "rect":
        lines.push(`  <rect ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"/>`);
        break;
      case "ellipse":
        lines.push(`  <ellipse ${common} cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"/>`);
        break;
      case "arrow":
        lines.push(`  <line ${common} x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" marker-end="url(#arrowhead)" style="color:${shape.stroke}"/>`);
        break;
      case "text": {
        const escaped = shape.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`  <text ${common} x="${shape.x}" y="${shape.y}" font-size="${shape.fontSize}" font-family="sans-serif">${escaped}</text>`);
        break;
      }
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
    return JSON.parse(raw) as DiagramData;
  } catch {
    return undefined;
  }
}
