import * as vscode from "vscode";
import type { WebviewToExtMessage, ExtToWebviewMessage } from "./types";
import {
  saveSvgFile,
  listTemplates,
  saveTemplate,
  loadTemplate,
  deleteTemplate,
} from "./fileUtils";

/**
 * Custom text editor provider that opens .svg files directly in the
 * Markdown SVG Sketch canvas editor.
 */
export class SvgEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "markdownSvgSketch.svgEditor";

  constructor(private readonly extensionUri: vscode.Uri) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
    };

    webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview);

    // Send initial SVG content once webview reports ready
    const messageHandler = webviewPanel.webview.onDidReceiveMessage(
      async (msg: WebviewToExtMessage) => {
        switch (msg.command) {
          case "ready":
            this.postMessage(webviewPanel, {
              command: "init",
              svgContent: document.getText(),
            });
            await this.postTemplatesList(webviewPanel);
            break;
          case "save":
            await this.handleSave(document, msg.svgContent);
            break;
          case "listTemplates":
            await this.postTemplatesList(webviewPanel);
            break;
          case "saveTemplate": {
            const saved = await saveTemplate(msg.name, msg.shapes);
            if (!saved) {
              this.postMessage(webviewPanel, {
                command: "error",
                message: "Template name and shapes are required.",
              });
              return;
            }
            this.postMessage(webviewPanel, { command: "templateSaved", template: saved });
            await this.postTemplatesList(webviewPanel);
            break;
          }
          case "applyTemplate": {
            const template = await loadTemplate(msg.templateId);
            if (!template) {
              this.postMessage(webviewPanel, {
                command: "error",
                message: "Template not found.",
              });
              return;
            }
            this.postMessage(webviewPanel, {
              command: "templatePayload",
              templateId: template.id,
              name: template.name,
              shapes: template.diagram.shapes,
            });
            break;
          }
          case "deleteTemplate": {
            const ok = await deleteTemplate(msg.templateId);
            if (!ok) {
              this.postMessage(webviewPanel, {
                command: "error",
                message: "Failed to delete template.",
              });
              return;
            }
            this.postMessage(webviewPanel, {
              command: "templateDeleted",
              templateId: msg.templateId,
            });
            await this.postTemplatesList(webviewPanel);
            break;
          }
        }
      },
    );

    webviewPanel.onDidDispose(() => {
      messageHandler.dispose();
    });
  }

  private postMessage(panel: vscode.WebviewPanel, msg: ExtToWebviewMessage): void {
    panel.webview.postMessage(msg);
  }

  private async postTemplatesList(panel: vscode.WebviewPanel): Promise<void> {
    const templates = await listTemplates();
    this.postMessage(panel, { command: "templatesList", templates });
  }

  private async handleSave(
    document: vscode.TextDocument,
    svgContent: string,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      svgContent,
    );
    await vscode.workspace.applyEdit(edit);
    await document.save();
    vscode.window.showInformationMessage(`SVG saved: ${document.uri.fsPath}`);
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const webviewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview.js"),
    );
    const nonce = getNonce();
    const cspSource = webview.cspSource;

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
      display: none; gap: 4px; padding: 4px 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      align-items: center; font-size: 12px;
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
  </style>
</head>
<body>
  <div id="toolbar">
    <button data-tool="select" title="Select (V)">⇱ Select</button>
    <button data-tool="rect" class="active" title="Rectangle (R)">▭ Rect</button>
    <button data-tool="ellipse" title="Ellipse (E)">◯ Ellipse</button>
    <button data-tool="arrow" title="Arrow (A)">→ Arrow</button>
    <button data-tool="text" title="Text (T)">T Text</button>
    <button data-tool="table" title="Table (G)">⊞ Table</button>
    <div class="separator"></div>
    <label>Stroke</label><input type="color" id="stroke-color" value="#000000">
    <label>Fill</label><input type="color" id="fill-color" value="#ffffff">
    <label>Width</label><input type="number" id="line-width" value="2" min="1" max="20">
    <div class="separator"></div>
    <button id="btn-undo" title="Undo (Ctrl+Z)">↶ Undo</button>
    <button id="btn-redo" title="Redo (Ctrl+Y)">↷ Redo</button>
    <button id="btn-delete" title="Delete selected (Del)">🗑 Delete</button>
    <div class="separator"></div>
    <input id="template-name" type="text" placeholder="Template name">
    <button id="btn-save-template" title="Save current diagram as template">Save Template</button>
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
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
