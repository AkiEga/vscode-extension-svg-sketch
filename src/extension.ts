import * as vscode from "vscode";
import * as path from "path";
import { SvgEditorProvider } from "./svgEditorProvider";

export function activate(context: vscode.ExtensionContext) {
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
    vscode.commands.registerCommand("svg-sketch.newDiagram", async () => {
      const uri = vscode.Uri.parse("untitled:new.svg");
      await vscode.commands.executeCommand("vscode.openWith", uri, SvgEditorProvider.viewType);
    }),
  );

  // Edit SVG — open an existing .svg in the custom editor
  context.subscriptions.push(
    vscode.commands.registerCommand("svg-sketch.editSvg", async (uri?: vscode.Uri) => {
      // エクスプローラーの右クリックから呼ばれた場合は uri が渡される
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      await vscode.commands.executeCommand("vscode.openWith", target, SvgEditorProvider.viewType);
    }),
  );

  // Create SVG File — create a new SVG file in the configured output directory
  context.subscriptions.push(
    vscode.commands.registerCommand("svg-sketch.createSvgFile", async () => {
      const config = vscode.workspace.getConfiguration("svg-sketch");
      const outputDir = config.get<string>("svgOutputDir", "images");

      // ファイル名を入力
      const fileName = await vscode.window.showInputBox({
        prompt: "SVGファイル名を入力してください（拡張子なし）",
        placeHolder: "diagram",
        validateInput: (value) => {
          if (!value || value.trim() === "") {
            return "ファイル名を入力してください";
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
            return "ファイル名には英数字、ハイフン、アンダースコアのみ使用できます";
          }
          return null;
        },
      });

      if (!fileName) {
        return;
      }

      // 保存先ディレクトリを決定
      let targetDir: vscode.Uri | undefined;
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const activeEditor = vscode.window.activeTextEditor;
      const isMarkdownEditor = activeEditor?.document.languageId === "markdown";

      if (activeEditor && activeEditor.document.uri.scheme === "file") {
        // アクティブなファイルがある場合、そのディレクトリを基準にする
        const currentFileDir = vscode.Uri.joinPath(activeEditor.document.uri, "..");
        targetDir = vscode.Uri.joinPath(currentFileDir, outputDir);
      } else if (workspaceFolder) {
        // ワークスペースルートを基準にする
        targetDir = vscode.Uri.joinPath(workspaceFolder.uri, outputDir);
      } else {
        void vscode.window.showErrorMessage("ワークスペースが開かれていません");
        return;
      }

      // ディレクトリが存在しない場合は作成
      try {
        await vscode.workspace.fs.stat(targetDir);
      } catch {
        await vscode.workspace.fs.createDirectory(targetDir);
      }

      // SVGファイルのパスを作成
      const svgUri = vscode.Uri.joinPath(targetDir, `${fileName}.svg`);

      // ファイルが既に存在する場合は確認
      try {
        await vscode.workspace.fs.stat(svgUri);
        const overwrite = await vscode.window.showWarningMessage(
          `ファイル "${fileName}.svg" は既に存在します。上書きしますか？`,
          "上書き",
          "キャンセル",
        );
        if (overwrite !== "上書き") {
          return;
        }
      } catch {
        // ファイルが存在しない場合は何もしない
      }

      // 空のSVGファイルを作成
      const emptySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <!-- Created with SVG Sketch -->
</svg>`;
      await vscode.workspace.fs.writeFile(svgUri, Buffer.from(emptySvg, "utf-8"));

      // Markdownファイルの場合、カーソル位置にリンクを挿入
      if (isMarkdownEditor && activeEditor) {
        const relativePath = activeEditor.document.uri.scheme === "file" 
          ? path.relative(
              path.dirname(activeEditor.document.uri.fsPath),
              svgUri.fsPath
            ).replace(/\\/g, "/")
          : `${outputDir}/${fileName}.svg`;
        
        const markdownLink = `![${fileName}](${relativePath})`;
        
        await activeEditor.edit((editBuilder) => {
          editBuilder.insert(activeEditor.selection.active, markdownLink);
        });
      }

      // SVG Sketchエディタで開く
      await vscode.commands.executeCommand("vscode.openWith", svgUri, SvgEditorProvider.viewType);

      void vscode.window.showInformationMessage(`SVGファイルを作成しました: ${path.relative(workspaceFolder?.uri.fsPath ?? "", svgUri.fsPath)}`);
    }),
  );
}

export function deactivate() {}
