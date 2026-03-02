/**
 * web/server.ts — SVG Sketch スタンドアロン Web サーバー
 *
 * Usage:
 *   node out/svg-sketch-cli.js serve [--port 3000] [--file diagram.svg]
 *
 * ブラウザで SVG の作成・編集が可能。
 * ファイル指定時はそのSVGを読み込んで編集開始。
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { parseDiagramData } from "../src/svgExporter";

export interface ServeOptions {
  port: number;
  file?: string;
}

export function startServer(options: ServeOptions): void {
  const { port, file } = options;

  // out/web-client.js を読み込む（バンドル済み webview コード）
  const clientJsPath = path.join(__dirname, "web-client.js");

  let initialSvgContent = "";
  if (file) {
    const resolved = path.resolve(file);
    if (fs.existsSync(resolved)) {
      initialSvgContent = fs.readFileSync(resolved, "utf-8");
    } else {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(generateHtml(initialSvgContent));
      return;
    }

    if (url.pathname === "/web-client.js" && req.method === "GET") {
      if (fs.existsSync(clientJsPath)) {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(fs.readFileSync(clientJsPath, "utf-8"));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("web-client.js not found. Run build first.");
      }
      return;
    }

    if (url.pathname === "/api/save" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        if (file) {
          const resolved = path.resolve(file);
          fs.writeFileSync(resolved, body, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, path: resolved }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, note: "No file specified. SVG not saved to disk." }));
        }
      });
      return;
    }

    if (url.pathname === "/api/load" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (file && fs.existsSync(path.resolve(file))) {
        const content = fs.readFileSync(path.resolve(file), "utf-8");
        const data = parseDiagramData(content);
        res.end(JSON.stringify({ svgContent: content, shapes: data?.shapes ?? [] }));
      } else {
        res.end(JSON.stringify({ svgContent: "", shapes: [] }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`SVG Sketch Web Editor: http://localhost:${port}`);
    if (file) {
      console.log(`Editing: ${path.resolve(file)}`);
    }
  });
}

function generateHtml(initialSvgContent: string): string {
  const escapedSvg = initialSvgContent
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Sketch — Web Editor</title>
  <style>
    :root {
      --vscode-editor-background: #1e1e1e;
      --vscode-editor-foreground: #d4d4d4;
      --vscode-sideBar-background: #252526;
      --vscode-panel-border: #3c3c3c;
      --vscode-button-secondaryBackground: #3a3d41;
      --vscode-button-secondaryForeground: #cccccc;
      --vscode-button-secondaryHoverBackground: #4a4d51;
      --vscode-button-background: #0e639c;
      --vscode-button-foreground: #ffffff;
      --vscode-button-border: transparent;
      --vscode-input-background: #3c3c3c;
      --vscode-input-foreground: #cccccc;
      --vscode-input-border: #3c3c3c;
      --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --vscode-font-size: 13px;
      --vscode-focusBorder: #007acc;
      --vscode-list-hoverBackground: #2a2d2e;
      --vscode-editorWidget-background: #252526;
      --vscode-widget-border: #454545;
      --vscode-menu-background: #252526;
      --vscode-menu-foreground: #cccccc;
      --vscode-menu-border: #454545;
      --vscode-menu-selectionBackground: #094771;
      --vscode-menu-selectionForeground: #ffffff;
      --vscode-list-hoverForeground: #ffffff;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }

    #toolbar {
      display: flex; gap: 4px; padding: 6px 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-wrap: wrap; align-items: center;
    }
    #toolbar .row-break { flex-basis: 100%; height: 0; }
    #toolbar button {
      padding: 4px 10px; cursor: pointer;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px; font-size: 12px;
    }
    #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    #toolbar button.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #toolbar .separator { width: 1px; height: 20px; background: var(--vscode-panel-border); margin: 0 4px; }

    #toolbar label { font-size: 11px; margin-left: 4px; }
    #toolbar input[type="color"] { width: 28px; height: 22px; border: none; cursor: pointer; }
    #toolbar input[type="number"] { width: 40px; padding: 2px 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    #toolbar select { padding: 2px 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-size: 11px; }
    #toolbar .check-inline { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; }
    #toolbar .check-inline input[type="checkbox"] { margin: 0; }
    #toolbar .palette-toggle {
      margin-left: 6px; font-size: 13px; padding: 2px 6px; cursor: pointer;
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px;
    }
    #toolbar .palette-toggle:hover { background: var(--vscode-button-secondaryHoverBackground); }
    #toolbar .palette-block { display: none; align-items: center; gap: 4px; margin-left: 4px; }
    #toolbar .palette-block.expanded { display: inline-flex; }
    #toolbar .palette-label { font-size: 10px; opacity: 0.85; margin: 0 2px 0 4px; }
    #toolbar .palette-swatches { display: inline-flex; align-items: center; gap: 3px; }
    #toolbar .palette-swatch {
      width: 14px; height: 14px; border-radius: 999px; padding: 0;
      border: 1px solid var(--vscode-panel-border);
      min-width: 14px;
    }
    #toolbar .palette-swatch.active {
      outline: 2px solid var(--vscode-focusBorder, #007acc);
      outline-offset: 1px;
    }

    #canvas-container { flex: 1; overflow: hidden; position: relative; }
    #canvas { display: block; background: #ffffff; cursor: crosshair; }
    #canvas.tool-select { cursor: default; }

    #table-toolbar {
      display: flex; gap: 4px; padding: 4px 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      align-items: center; font-size: 12px;
      min-height: 32px;
      visibility: hidden;
    }
    #table-toolbar span { opacity: 0.8; }
    #table-toolbar button {
      padding: 3px 8px; cursor: pointer;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px; font-size: 12px;
    }
    #table-toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .ctx-menu {
      position: absolute;
      z-index: 30;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #fff));
      color: var(--vscode-menu-foreground, var(--vscode-editor-foreground, #000));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, #ccc));
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      padding: 4px 0;
      min-width: 140px;
      font-size: 12px;
    }
    .ctx-menu-item {
      padding: 4px 16px;
      cursor: pointer;
      white-space: nowrap;
    }
    .ctx-menu-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground, #094771));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-hoverForeground, #fff));
    }

    #status-bar {
      display: flex; gap: 8px; padding: 2px 8px;
      background: #007acc; color: #fff; font-size: 11px;
      align-items: center; min-height: 22px;
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <button data-tool="select" class="active" title="Select (V)">⇱ Select</button>
    <button data-tool="rect" title="Rectangle (R)">▭ Rect</button>
    <button data-tool="ellipse" title="Ellipse (E)">◯ Ellipse</button>
    <button data-tool="arrow" title="Arrow (A)">→ Arrow</button>
    <button data-tool="text" title="Text (T)">T Text</button>
    <button data-tool="bubble" title="Speech Bubble (B)">💬 Bubble</button>
    <button data-tool="table" title="Table (G)">⊞ Table</button>
    <div class="separator"></div>
    <label>Stroke</label><input type="color" id="stroke-color" value="#000000">
    <label>Fill</label><input type="color" id="fill-color" value="#ffffff">
    <button id="palette-toggle" class="palette-toggle" title="Toggle Palette">🎨</button>
    <div id="palette-block" class="palette-block">
      <span class="palette-label">S</span><div id="palette-stroke" class="palette-swatches"></div>
      <span class="palette-label">F</span><div id="palette-fill" class="palette-swatches"></div>
    </div>
    <label>Width</label><input type="number" id="line-width" value="2" min="0" max="20">
    <label class="check-inline"><input type="checkbox" id="borderless">No border</label>
    <div class="separator"></div>
    <label>Font</label><input type="color" id="font-color" value="#000000">
    <input type="number" id="font-size" value="16" min="6" max="120" style="width:45px" title="Font size">
    <select id="font-family" title="Font family">
      <option value="sans-serif">Sans-serif</option>
      <option value="serif">Serif</option>
      <option value="monospace">Monospace</option>
      <option value="cursive">Cursive</option>
    </select>
    <div class="separator"></div>
    <button id="btn-undo" title="Undo (Ctrl+Z)">↶ Undo</button>
    <button id="btn-redo" title="Redo (Ctrl+Y)">↷ Redo</button>
    <button id="btn-delete" title="Delete selected (Del)">🗑 Delete</button>
    <button id="btn-edit-label" title="Edit selected label (F2)">✎ Label</button>
    <button id="btn-group" title="Group selected (Ctrl+G)">Group</button>
    <button id="btn-ungroup" title="Ungroup selected (Ctrl+Shift+G)">Ungroup</button>
    <button id="btn-snap" title="Grid Snap (S)">⊞ Snap</button>
    <div class="row-break"></div>
    <div class="separator"></div>
    <button id="btn-save" title="Save SVG">💾 Save</button>
    <button id="btn-download" title="Download SVG">⬇ Download</button>
  </div>
  <div id="table-toolbar">
    <span>Table:</span>
    <button id="btn-add-row" title="Add row">+ Row</button>
    <button id="btn-del-row" title="Delete row">- Row</button>
    <button id="btn-add-col" title="Add column">+ Col</button>
    <button id="btn-del-col" title="Delete column">- Col</button>
  </div>
  <div id="canvas-container">
    <canvas id="canvas"></canvas>
  </div>
  <div id="status-bar">
    <span id="status-text">Ready</span>
  </div>
  <script>
    // Web アプリ用グローバル設定
    window.__SVG_SKETCH_WEB__ = true;
    window.__SVG_SKETCH_INITIAL_SVG__ = \`${escapedSvg}\`;
  </script>
  <script src="/web-client.js"></script>
</body>
</html>`;
}
