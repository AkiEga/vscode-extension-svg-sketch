import * as vscode from "vscode";
import type { WebviewToExtMessage, ExtToWebviewMessage, Shape } from "./types";
import { shapesToSvg, parseDiagramData } from "./svgExporter";
import { resolveNewSvgPath, saveSvgFile, insertMarkdownLink } from "./fileUtils";

export class DiagramPanel {
  public static readonly viewType = "markdownSvgSketch.editor";
  private static instance: DiagramPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private mdEditor: vscode.TextEditor | undefined;
  private existingSvgUri: vscode.Uri | undefined;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    mdEditor: vscode.TextEditor | undefined,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.mdEditor = mdEditor;

    this.panel.webview.html = this.getHtmlContent();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      undefined,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /** Create or reveal the diagram panel for a new diagram */
  public static createOrShow(
    extensionUri: vscode.Uri,
    mdEditor?: vscode.TextEditor,
  ): DiagramPanel {
    if (DiagramPanel.instance) {
      DiagramPanel.instance.mdEditor = mdEditor;
      DiagramPanel.instance.existingSvgUri = undefined;
      DiagramPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      DiagramPanel.instance.postMessage({ command: "init" });
      return DiagramPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      DiagramPanel.viewType,
      "SVG Sketch",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
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
    inst.postMessage({ command: "init", svgContent });
    return inst;
  }

  private postMessage(msg: ExtToWebviewMessage): void {
    this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.command) {
      case "save":
        await this.handleSave(msg.svgContent);
        break;
      case "ready":
        break;
    }
  }

  private async handleSave(svgContent: string): Promise<void> {
    if (this.existingSvgUri) {
      // Overwrite existing SVG
      await saveSvgFile(this.existingSvgUri, svgContent);
      vscode.window.showInformationMessage(
        `SVG saved: ${this.existingSvgUri.fsPath}`,
      );
      return;
    }

    // New diagram: resolve path and save
    if (!this.mdEditor || this.mdEditor.document.isClosed) {
      this.mdEditor = vscode.window.visibleTextEditors.find(
        (e) => e.document.languageId === "markdown",
      );
    }

    if (!this.mdEditor) {
      vscode.window.showErrorMessage("No Markdown editor found to insert the link.");
      return;
    }

    const result = await resolveNewSvgPath(this.mdEditor.document.uri);
    if (!result) {
      return;
    }

    const [fileUri, relativePath] = result;
    await saveSvgFile(fileUri, svgContent);
    await insertMarkdownLink(this.mdEditor, relativePath);
    this.existingSvgUri = fileUri;
    vscode.window.showInformationMessage(`SVG saved: ${relativePath}`);
  }

  private getHtmlContent(): string {
    const webviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview.js"),
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
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
  </style>
</head>
<body>
  <div id="toolbar">
    <button data-tool="select" title="Select (V)">⇱ Select</button>
    <button data-tool="rect" class="active" title="Rectangle (R)">▭ Rect</button>
    <button data-tool="ellipse" title="Ellipse (E)">◯ Ellipse</button>
    <button data-tool="arrow" title="Arrow (A)">→ Arrow</button>
    <button data-tool="text" title="Text (T)">T Text</button>
    <div class="separator"></div>
    <label>Stroke</label><input type="color" id="stroke-color" value="#000000">
    <label>Fill</label><input type="color" id="fill-color" value="#ffffff">
    <label>Width</label><input type="number" id="line-width" value="2" min="1" max="20">
    <div class="separator"></div>
    <button id="btn-undo" title="Undo (Ctrl+Z)">↶ Undo</button>
    <button id="btn-redo" title="Redo (Ctrl+Y)">↷ Redo</button>
    <button id="btn-delete" title="Delete selected (Del)">🗑 Delete</button>
    <div class="separator"></div>
    <button id="btn-save" title="Save SVG">💾 Save</button>
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
