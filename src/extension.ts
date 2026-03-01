import * as vscode from "vscode";
import { SvgEditorProvider } from "./svgEditorProvider";
import { ensureTemplateStorageWithSeed } from "./fileUtils";

export function activate(context: vscode.ExtensionContext) {
  void ensureTemplateStorageWithSeed();

  // Custom editor for .svg files
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SvgEditorProvider.viewType,
      new SvgEditorProvider(context.extensionUri),
      { supportsMultipleEditorsPerDocument: false },
    ),
  );

  // New SVG command — create an untitled .svg and open it in the custom editor
  context.subscriptions.push(
    vscode.commands.registerCommand("markdown-svg-sketch.newDiagram", async () => {
      const uri = vscode.Uri.parse("untitled:new.svg");
      await vscode.commands.executeCommand("vscode.openWith", uri, SvgEditorProvider.viewType);
    }),
  );
}

export function deactivate() {}
