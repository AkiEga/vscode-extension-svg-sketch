import * as vscode from "vscode";

export const ASCII_BLOCK_LANGUAGE = "ascii-sketch";

const ASCII_BLOCK_PATTERN = /```ascii-sketch\r?\n([\s\S]*?)\r?\n```/g;
const EDITING_PLACEHOLDER_PATTERN = /^Editing\.\.\. \(id: ([a-f0-9]+)\)$/i;

export interface AsciiBlockMatch {
  range: vscode.Range;
  content: string;
}

function getDocumentEol(documentOrEditor: vscode.TextDocument | vscode.TextEditor): string {
  const document = "document" in documentOrEditor ? documentOrEditor.document : documentOrEditor;
  return document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
}

export function formatAsciiBlock(content: string, eol = "\n"): string {
  const normalized = content.replace(/\r\n/g, "\n");
  return `\u0060\u0060\u0060${ASCII_BLOCK_LANGUAGE}${eol}${normalized}${eol}\u0060\u0060\u0060`;
}

export function formatEditingPlaceholder(id: string, eol = "\n"): string {
  return formatAsciiBlock(`Editing... (id: ${id})`, eol);
}

export function parseEditingPlaceholderId(content: string): string | undefined {
  return EDITING_PLACEHOLDER_PATTERN.exec(content.trim())?.[1];
}

export function findAsciiBlock(document: vscode.TextDocument, position: vscode.Position): AsciiBlockMatch | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  ASCII_BLOCK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASCII_BLOCK_PATTERN.exec(text)) !== null) {
    const startOffset = match.index;
    const endOffset = startOffset + match[0].length;
    if (offset < startOffset || offset > endOffset) {
      continue;
    }
    return {
      range: new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset)),
      content: match[1].replace(/\r\n/g, "\n"),
    };
  }
  return undefined;
}

export function findEditingPlaceholder(document: vscode.TextDocument, id: string): AsciiBlockMatch | undefined {
  const text = document.getText();
  ASCII_BLOCK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASCII_BLOCK_PATTERN.exec(text)) !== null) {
    const placeholderId = parseEditingPlaceholderId(match[1]);
    if (placeholderId !== id) {
      continue;
    }
    const startOffset = match.index;
    const endOffset = startOffset + match[0].length;
    return {
      range: new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset)),
      content: match[1].replace(/\r\n/g, "\n"),
    };
  }
  return undefined;
}

export async function insertAsciiBlock(editor: vscode.TextEditor, position: vscode.Position, content: string): Promise<vscode.Range | undefined> {
  const block = formatAsciiBlock(content, getDocumentEol(editor));
  let insertedRange: vscode.Range | undefined;
  await editor.edit((editBuilder) => {
    editBuilder.insert(position, block);
    insertedRange = new vscode.Range(position, position.translate(block.split("\n").length - 1, block.split("\n").at(-1)?.length ?? 0));
  });
  return insertedRange;
}

export async function replaceAsciiBlock(editor: vscode.TextEditor, range: vscode.Range, content: string): Promise<void> {
  await editor.edit((editBuilder) => {
    editBuilder.replace(range, formatAsciiBlock(content, getDocumentEol(editor)));
  });
}

export async function replaceRange(editor: vscode.TextEditor, range: vscode.Range, text: string): Promise<void> {
  await editor.edit((editBuilder) => {
    editBuilder.replace(range, text);
  });
}

export async function deleteRange(editor: vscode.TextEditor, range: vscode.Range): Promise<void> {
  await editor.edit((editBuilder) => {
    editBuilder.delete(range);
  });
}
