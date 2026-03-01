import * as vscode from "vscode";
import { reviveShapes, type WebviewToExtMessage, type ExtToWebviewMessage, type ShapeJSON } from "./types";
import {
  listTemplates,
  saveTemplate,
  saveTemplateSvg,
  loadTemplate,
  deleteTemplate,
} from "./fileUtils";
import { getEditorSettings } from "./settings";

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
        await this.postTemplatesList();
        break;
      case "listTemplates":
        await this.postTemplatesList();
        break;
      case "saveTemplate": {
        const saved = await saveTemplate(msg.name, reviveShapes(msg.shapes));
        if (!saved) {
          this.postMessage({ command: "error", message: "Template name and shapes are required." });
          return;
        }
        this.postMessage({ command: "templateSaved", template: saved });
        await this.postTemplatesList();
        break;
      }
      case "saveTemplateSvg": {
        if (!msg.name.trim() || !msg.svgContent.trim()) {
          this.postMessage({ command: "error", message: "Template name and SVG content are required." });
          return;
        }
        const path = await saveTemplateSvg(msg.name, msg.svgContent);
        if (!path) {
          this.postMessage({ command: "error", message: "Failed to save SVG template." });
          return;
        }
        void vscode.window.showInformationMessage(`Template SVG saved: ${path}`);
        break;
      }
      case "applyTemplate": {
        const template = await loadTemplate(msg.templateId);
        if (!template) {
          this.postMessage({ command: "error", message: "Template not found." });
          return;
        }
        this.postMessage({
          command: "templatePayload",
          templateId: template.id,
          name: template.name,
          shapes: template.diagram.shapes as unknown as ShapeJSON[],
        });
        break;
      }
      case "deleteTemplate": {
        const ok = await deleteTemplate(msg.templateId);
        if (!ok) {
          this.postMessage({ command: "error", message: "Failed to delete template." });
          return;
        }
        this.postMessage({ command: "templateDeleted", templateId: msg.templateId });
        await this.postTemplatesList();
        break;
      }
    }
  }

  private async postTemplatesList(): Promise<void> {
    const templates = await listTemplates();
    this.postMessage({ command: "templatesList", templates });
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
    #toolbar .check-inline { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; }
    #toolbar .check-inline input[type="checkbox"] { margin: 0; }

    #canvas-container { flex: 1; overflow: hidden; position: relative; }
    #canvas { display: block; background: #ffffff; cursor: crosshair; }
    #canvas.tool-select { cursor: default; }

    #template-panel {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 280px;
      max-height: calc(100% - 24px);
      overflow: auto;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
      padding: 8px;
      display: none;
      z-index: 20;
    }
    #template-panel.open { display: block; }
    #template-panel h3 { font-size: 12px; margin-bottom: 8px; }
    #template-list { display: grid; gap: 8px; }
    .template-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 6px;
      display: grid;
      gap: 6px;
      background: var(--vscode-sideBar-background);
    }
    .template-title { font-size: 12px; font-weight: 600; }
    .template-meta { font-size: 11px; opacity: 0.8; }
    .template-preview {
      width: 100%;
      height: 80px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      background: #fff;
      object-fit: contain;
    }
    .template-actions { display: flex; gap: 6px; }
    .template-actions button { flex: 1; }
    #template-name {
      width: 160px;
      padding: 2px 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
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
    <button data-tool="rect" title="Rectangle (R)">▭ Rect</button>
    <button data-tool="ellipse" title="Ellipse (E)">◯ Ellipse</button>
    <button data-tool="arrow" title="Arrow (A)">→ Arrow</button>
    <button data-tool="text" title="Text (T)">T Text</button>
    <button data-tool="bubble" title="Speech Bubble (B)">💬 Bubble</button>
    <button data-tool="table" title="Table (G)">⊞ Table</button>
    <div class="separator"></div>
    <label>Stroke</label><input type="color" id="stroke-color" value="#000000">
    <label>Fill</label><input type="color" id="fill-color" value="#ffffff">
    <label>Width</label><input type="number" id="line-width" value="2" min="0" max="20">
    <label class="check-inline"><input type="checkbox" id="borderless">No border</label>
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
    <input id="template-name" type="text" placeholder="Template name">
    <button id="btn-save-template" title="Save current diagram as template">Save Template</button>
    <button id="btn-save-template-svg" title="Save current diagram as SVG template">Save Template SVG</button>
    <button id="btn-toggle-templates" title="Show templates">Templates</button>
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
    <aside id="template-panel" aria-label="Template panel">
      <h3>Presentation Templates</h3>
      <div id="template-list"></div>
    </aside>
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
