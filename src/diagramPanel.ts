import * as vscode from "vscode";
import { createHash } from "node:crypto";
import {
  deleteRange,
  findAsciiBlock,
  findEditingPlaceholder,
  formatEditingPlaceholder,
  insertAsciiBlock,
  replaceAsciiBlock,
  replaceRange,
} from "./markdownIntegration";
import { getEditorSettings } from "./settings";
import type { WebviewToExtMessage, ExtToWebviewMessage } from "./types";

export class DiagramPanel {
  public static readonly viewType = "asciiSketch.editor";
  private static instance: DiagramPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private mdEditor: vscode.TextEditor | undefined;
  private blockRange: vscode.Range | undefined;
  private editingBlockId: string | undefined;
  private committedContent: string | undefined;
  private pendingInitContent: string | undefined;
  private insertionPosition: vscode.Position | undefined;
  private skipRestoreOnDispose = false;
  private isDisposing = false;
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
    this.panel.onDidDispose(() => {
      void this.dispose();
    }, undefined, this.disposables);

    // Defer HTML injection so VS Code's internal webview ServiceWorker
    // initialisation completes before the document is replaced.
    setTimeout(() => {
      this.panel.webview.html = this.getHtmlContent();
    }, 0);
  }

  /** Create or reveal the diagram panel for a new diagram */
  public static async createOrShow(
    extensionUri: vscode.Uri,
    mdEditor?: vscode.TextEditor,
    initialContent?: string,
    blockRange?: vscode.Range,
    insertionPosition?: vscode.Position,
  ): Promise<DiagramPanel> {
    if (DiagramPanel.instance) {
      await DiagramPanel.instance.switchTarget(mdEditor, initialContent, blockRange, insertionPosition);
      return DiagramPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      DiagramPanel.viewType,
      "ASCII Sketch",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
      },
    );

    DiagramPanel.instance = new DiagramPanel(panel, extensionUri, mdEditor);
    await DiagramPanel.instance.switchTarget(mdEditor, initialContent, blockRange, insertionPosition, false);
    return DiagramPanel.instance;
  }

  private postMessage(msg: ExtToWebviewMessage): void {
    this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.command) {
      case "ready":
        this.postMessage({ command: "init", content: this.pendingInitContent, settings: getEditorSettings() });
        this.pendingInitContent = undefined;
        break;
      case "save":
        await this.saveToMarkdown(msg.content);
        break;
      case "saveAndClose":
        await this.finalizeToMarkdown(msg.content);
        this.skipRestoreOnDispose = true;
        this.panel.dispose();
        break;
      case "close":
        this.panel.dispose();
        break;
    }
  }

  private async saveToMarkdown(content: string): Promise<void> {
    if (!this.mdEditor) {
      void vscode.window.showErrorMessage("保存先の Markdown エディタが見つかりません。");
      return;
    }
    if (this.editingBlockId) {
      const placeholder = findEditingPlaceholder(this.mdEditor.document, this.editingBlockId);
      if (!placeholder) {
        void vscode.window.showErrorMessage("編集中プレースホルダが見つかりません。Markdown 側のプレースホルダを確認してください。");
        return;
      }
      this.blockRange = placeholder.range;
      this.committedContent = content;
      return;
    }
    await this.finalizeToMarkdown(content);
  }

  private async finalizeToMarkdown(content: string): Promise<void> {
    if (!this.mdEditor) {
      void vscode.window.showErrorMessage("保存先の Markdown エディタが見つかりません。");
      return;
    }
    if (this.editingBlockId) {
      const placeholder = findEditingPlaceholder(this.mdEditor.document, this.editingBlockId);
      if (!placeholder) {
        void vscode.window.showErrorMessage("編集中プレースホルダが見つかりません。Markdown 側のプレースホルダを確認してください。");
        return;
      }
      await replaceAsciiBlock(this.mdEditor, placeholder.range, content);
      this.blockRange = findAsciiBlock(this.mdEditor.document, placeholder.range.start)?.range;
      this.committedContent = content;
      this.editingBlockId = undefined;
      return;
    }
    if (this.blockRange) {
      await replaceAsciiBlock(this.mdEditor, this.blockRange, content);
      this.blockRange = findAsciiBlock(this.mdEditor.document, this.blockRange.start)?.range;
      this.committedContent = content;
      return;
    }
    const position = this.insertionPosition ?? this.mdEditor.selection.active;
    await insertAsciiBlock(this.mdEditor, position, content);
    this.blockRange = findAsciiBlock(this.mdEditor.document, position)?.range;
    this.committedContent = content;
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
  <title>ASCII Sketch</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }

    #toolbar {
      display: flex; gap: 8px; padding: 8px 10px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      align-items: center;
    }
    #toolbar button {
      padding: 4px 10px; cursor: pointer;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px; font-size: 12px;
    }
    #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    #toolbar button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #status { margin-left: auto; opacity: 0.8; font-size: 12px; }
    #canvas-container { flex: 1; overflow: auto; background: var(--vscode-editor-background); }
    #canvas { display: block; margin: 12px; outline: none; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="btn-save" class="primary" title="Save an internal cache (Ctrl+X Ctrl+S)">Save an internal cache</button>
    <button id="btn-close" title="Close">Close</button>
    <span id="status">Row 1, Col 1 | 80x20</span>
  </div>
  <div id="canvas-container">
    <canvas id="canvas"></canvas>
  </div>
  <script nonce="${nonce}" src="${webviewUri}"></script>
</body>
</html>`;
  }

  private async switchTarget(
    mdEditor?: vscode.TextEditor,
    initialContent?: string,
    blockRange?: vscode.Range,
    insertionPosition?: vscode.Position,
    reveal = true,
  ): Promise<void> {
    await this.restoreTrackedBlock();
    this.mdEditor = mdEditor;
    this.blockRange = blockRange;
    this.pendingInitContent = initialContent;
    this.insertionPosition = insertionPosition;
    this.committedContent = initialContent;
    this.skipRestoreOnDispose = false;
    await this.activateEditingPlaceholder();
    if (reveal) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }
    this.postMessage({ command: "init", content: initialContent, settings: getEditorSettings() });
  }

  private async activateEditingPlaceholder(): Promise<void> {
    if (!this.mdEditor) {
      this.editingBlockId = undefined;
      return;
    }

    this.editingBlockId = this.createEditingBlockId();
    const placeholderText = formatEditingPlaceholder(this.editingBlockId, this.mdEditor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");

    if (this.blockRange) {
      await replaceRange(this.mdEditor, this.blockRange, placeholderText);
      this.blockRange = findEditingPlaceholder(this.mdEditor.document, this.editingBlockId)?.range;
      return;
    }

    const position = this.insertionPosition ?? this.mdEditor.selection.active;
    await insertAsciiBlock(this.mdEditor, position, `Editing... (id: ${this.editingBlockId})`);
    this.blockRange = findEditingPlaceholder(this.mdEditor.document, this.editingBlockId)?.range;
  }

  private createEditingBlockId(): string {
    const position = this.blockRange?.start ?? this.insertionPosition ?? this.mdEditor?.selection.active;
    const seed = [
      this.mdEditor?.document.uri.toString() ?? "",
      position?.line ?? 0,
      position?.character ?? 0,
      Date.now(),
      Math.random(),
    ].join(":");
    return createHash("sha256").update(seed).digest("hex").slice(0, 12);
  }

  private async restoreTrackedBlock(): Promise<void> {
    if (!this.mdEditor || !this.editingBlockId) {
      return;
    }

    const placeholder = findEditingPlaceholder(this.mdEditor.document, this.editingBlockId);
    this.editingBlockId = undefined;
    if (!placeholder) {
      return;
    }

    if (this.committedContent === undefined) {
      await deleteRange(this.mdEditor, placeholder.range);
      this.blockRange = undefined;
      return;
    }

    await replaceAsciiBlock(this.mdEditor, placeholder.range, this.committedContent);
    this.blockRange = findAsciiBlock(this.mdEditor.document, placeholder.range.start)?.range;
  }

  private async dispose(): Promise<void> {
    if (this.isDisposing) {
      return;
    }
    this.isDisposing = true;
    if (!this.skipRestoreOnDispose) {
      await this.restoreTrackedBlock();
    }
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
