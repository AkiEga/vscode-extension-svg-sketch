import * as vscode from "vscode";
import { DiagramPanel } from "./diagramPanel";
import { findAsciiBlock } from "./markdownIntegration";

function getActiveMarkdownEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") {
    void vscode.window.showErrorMessage("Markdown エディタを開いてから実行してください。");
    return undefined;
  }
  return editor;
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("ascii-sketch.newDiagram", async () => {
      const editor = getActiveMarkdownEditor();
      if (!editor) {
        return;
      }
      await DiagramPanel.createOrShow(context.extensionUri, editor, undefined, undefined, editor.selection.active);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ascii-sketch.editDiagram", async () => {
      const editor = getActiveMarkdownEditor();
      if (!editor) {
        return;
      }
      const block = findAsciiBlock(editor.document, editor.selection.active);
      await DiagramPanel.createOrShow(
        context.extensionUri,
        editor,
        block?.content,
        block?.range,
        editor.selection.active,
      );
    }),
  );
}

export function deactivate() {}
