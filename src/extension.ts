import * as vscode from "vscode";
import { DiagramPanel } from "./diagramPanel";
import { parseDiagramData } from "./svgExporter";

export function activate(context: vscode.ExtensionContext) {
  // New diagram command
  context.subscriptions.push(
    vscode.commands.registerCommand("markdown-svg-sketch.newDiagram", () => {
      const editor = vscode.window.activeTextEditor;
      DiagramPanel.createOrShow(context.extensionUri, editor);
    }),
  );

  // Edit existing SVG command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "markdown-svg-sketch.editSvg",
      async (uri?: vscode.Uri) => {
        if (!uri) {
          const uris = await vscode.window.showOpenDialog({
            filters: { SVG: ["svg"] },
            canSelectMany: false,
          });
          if (!uris || uris.length === 0) {
            return;
          }
          uri = uris[0];
        }
        const content = Buffer.from(
          await vscode.workspace.fs.readFile(uri),
        ).toString("utf-8");
        DiagramPanel.editExisting(context.extensionUri, uri, content);
      },
    ),
  );
}

export function deactivate() {}
