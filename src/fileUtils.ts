import * as vscode from "vscode";
import * as path from "path";

/**
 * Resolve image directory and generate a unique SVG file path.
 * Returns [fileUri, relativePath] or undefined on error.
 */
export async function resolveNewSvgPath(
  mdFileUri: vscode.Uri
): Promise<[vscode.Uri, string] | undefined> {
  const config = vscode.workspace.getConfiguration("markdown-svg-sketch");
  const imgDir = config.get<string>("imgDir", "img");
  const prefix = config.get<string>("filePrefix", "diagram");

  const mdDir = path.dirname(mdFileUri.fsPath);
  const targetDir = path.join(mdDir, imgDir);

  // Ensure directory exists
  const targetDirUri = vscode.Uri.file(targetDir);
  try {
    await vscode.workspace.fs.stat(targetDirUri);
  } catch {
    await vscode.workspace.fs.createDirectory(targetDirUri);
  }

  // Find next available filename
  let index = 0;
  let filePath: string;
  while (true) {
    filePath = path.join(targetDir, `${prefix}_${index}.svg`);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      index++;
    } catch {
      break;
    }
  }

  const relativePath = path
    .relative(mdDir, filePath)
    .replace(/\\/g, "/");

  return [vscode.Uri.file(filePath), relativePath];
}

/**
 * Save SVG content to a file.
 */
export async function saveSvgFile(
  uri: vscode.Uri,
  svgContent: string
): Promise<void> {
  const content = Buffer.from(svgContent, "utf-8");
  await vscode.workspace.fs.writeFile(uri, content);
}

/**
 * Insert a markdown image link at the current cursor position.
 */
export async function insertMarkdownLink(
  editor: vscode.TextEditor,
  relativePath: string
): Promise<void> {
  const position = editor.selection.end;
  await editor.edit((editBuilder) => {
    editBuilder.insert(position, `![](${relativePath})`);
  });
}
