export interface CursorPos {
  row: number;
  col: number;
}

export interface SelectionRange {
  start: CursorPos;
  end: CursorPos;
}

export interface AsciiDocState {
  lines: string[];
  cursorPos: CursorPos;
}

export interface EditorSettings {
  defaultWidth: number;
  defaultHeight: number;
}

export type WebviewToExtMessage =
  | { command: "ready" }
  | { command: "save"; content: string }
  | { command: "saveAndClose"; content: string }
  | { command: "close" };

export type ExtToWebviewMessage =
  | { command: "init"; content?: string; settings: EditorSettings };


