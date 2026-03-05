import * as vscode from "vscode";
import { reviveShapes, type WebviewToExtMessage, type ExtToWebviewMessage } from "./types";
import { getEditorSettings } from "./settings";
import { shapeDefaults } from "./shapeConfig";

export class DiagramPanel {
  public static readonly viewType = "svgSketch.editor";
  private static instance: DiagramPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private mdEditor: vscode.TextEditor | undefined;
  private existingSvgUri: vscode.Uri | undefined;
  private pendingInitSvgContent: string | undefined;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    mdEditor: vscode.TextEditor | undefined,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.mdEditor = mdEditor;

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      undefined,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Defer HTML injection so VS Code's internal webview ServiceWorker
    // initialisation completes before the document is replaced.
    setTimeout(() => {
      this.panel.webview.html = this.getHtmlContent();
    }, 0);
  }

  /** Create or reveal the diagram panel for a new diagram */
  public static createOrShow(
    extensionUri: vscode.Uri,
    mdEditor?: vscode.TextEditor,
  ): DiagramPanel {
    if (DiagramPanel.instance) {
      DiagramPanel.instance.mdEditor = mdEditor;
      DiagramPanel.instance.existingSvgUri = undefined;
      DiagramPanel.instance.pendingInitSvgContent = undefined;
      DiagramPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      DiagramPanel.instance.postMessage({ command: "init", settings: getEditorSettings() });
      return DiagramPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      DiagramPanel.viewType,
      "SVG Sketch",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
      },
    );

    DiagramPanel.instance = new DiagramPanel(panel, extensionUri, mdEditor);
    return DiagramPanel.instance;
  }

  /** Open an existing SVG for editing */
  public static editExisting(
    extensionUri: vscode.Uri,
    svgUri: vscode.Uri,
    svgContent: string,
  ): DiagramPanel {
    const inst = DiagramPanel.createOrShow(extensionUri);
    inst.existingSvgUri = svgUri;
    inst.pendingInitSvgContent = svgContent;
    inst.postMessage({ command: "init", svgContent, settings: getEditorSettings() });
    return inst;
  }

  private postMessage(msg: ExtToWebviewMessage): void {
    this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.command) {
      case "ready":
        this.postMessage({ command: "init", svgContent: this.pendingInitSvgContent, settings: getEditorSettings() });
        this.pendingInitSvgContent = undefined;
        break;
      case "saveAndClose":
        this.panel.dispose();
        break;
      case "close":
        this.panel.dispose();
        break;
      case "closeWithoutSave":
        this.panel.dispose();
        break;
    }
  }

  private getHtmlContent(): string {
    const webviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview.js"),
    );
    const nonce = getNonce();
    const cspSource = this.panel.webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${cspSource} data:; worker-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Sketch</title>
  <style>
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

    .shape-insert-wrapper { position: relative; }
    #shape-insert-menu {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 2px;
      z-index: 40;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #fff));
      color: var(--vscode-menu-foreground, var(--vscode-editor-foreground, #000));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, #ccc));
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      padding: 4px 0;
      min-width: 120px;
    }
    #shape-insert-menu.open { display: block; }
    #shape-insert-menu button {
      display: block; width: 100%;
      padding: 5px 14px; text-align: left;
      background: transparent !important;
      color: var(--vscode-menu-foreground, var(--vscode-editor-foreground, #000)) !important;
      border: none !important; border-radius: 0 !important;
      font-size: 12px; cursor: pointer;
    }
    #shape-insert-menu button:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground, #094771)) !important;
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-hoverForeground, #fff)) !important;
    }
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
  </style>
</head>
<body>
  <div id="toolbar">
    <button data-tool="select" class="active" title="Select (V)">⇱ Select</button>
    <div class="shape-insert-wrapper">
      <button id="btn-insert-shape" title="Insert Shape">⊕ Insert Shape ▾</button>
      <div id="shape-insert-menu">
        <button data-tool="rect" title="Rectangle">▭ Rect</button>
        <button data-tool="ellipse" title="Ellipse">◯ Ellipse</button>
        <button data-tool="arrow" title="Arrow">→ Arrow</button>
        <button data-tool="text" title="Text">T Text</button>
        <button data-tool="table" title="Table">⊞ Table</button>
      </div>
    </div>
    <div class="separator"></div>
    <label>Stroke</label><input type="color" id="stroke-color" value="${shapeDefaults.stroke}">
    <label>Fill</label><input type="color" id="fill-color" value="${shapeDefaults.fill}">
    <button id="palette-toggle" class="palette-toggle" title="Toggle Palette">🎨</button>
    <div id="palette-block" class="palette-block">
      <span class="palette-label">S</span><div id="palette-stroke" class="palette-swatches"></div>
      <span class="palette-label">F</span><div id="palette-fill" class="palette-swatches"></div>
    </div>
    <label>Width</label><input type="number" id="line-width" value="${shapeDefaults.lineWidth}" min="0" max="20">
    <label>Round</label><input type="number" id="corner-radius" value="0" min="0" max="80" title="Rect corner radius">
    <label class="check-inline"><input type="checkbox" id="borderless">No border</label>
    <div class="separator"></div>
    <label>Font</label><input type="color" id="font-color" value="${shapeDefaults.fontColor}">
    <input type="number" id="font-size" value="${shapeDefaults.fontSize}" min="6" max="120" style="width:45px" title="Font size">
    <select id="font-family" title="Font family">
      <option value="${shapeDefaults.fontFamily}">Sans-serif</option>
      <option value="serif">Serif</option>
      <option value="monospace">Monospace</option>
      <option value="cursive">Cursive</option>
    </select>
    <select id="label-align-h" title="Label horizontal align">
      <option value="left">Label Left</option>
      <option value="center" selected>Label Center</option>
      <option value="right">Label Right</option>
    </select>
    <select id="label-align-v" title="Label vertical align">
      <option value="top">Label Top</option>
      <option value="middle" selected>Label Middle</option>
      <option value="bottom">Label Bottom</option>
    </select>
    <div class="separator"></div>
    <button id="btn-undo" title="Undo (Ctrl+Z)">↶ Undo</button>
    <button id="btn-redo" title="Redo (Ctrl+Y)">↷ Redo</button>
    <button id="btn-group" title="Group selected (Ctrl+Shift+G)">Group</button>
    <button id="btn-ungroup" title="Ungroup selected (Ctrl+U)">Ungroup</button>
    <div class="row-break"></div>
    <button id="btn-style" title="Render style (H): Plain → Sketch → Pencil">🖊 Style: Plain</button>
    <div class="separator"></div>
    <button id="btn-save" title="Save SVG">💾 Save</button>
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
  <script nonce="${nonce}" src="${webviewUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    DiagramPanel.instance = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
