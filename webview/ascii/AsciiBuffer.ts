export interface CursorPos {
  row: number;
  col: number;
}

export interface SelectionRange {
  start: CursorPos;
  end: CursorPos;
}

export interface NormalizedSelection {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

function repeatSpaces(count: number): string {
  return count > 0 ? " ".repeat(count) : "";
}

function cloneCells(cells: string[][]): string[][] {
  return cells.map((row) => [...row]);
}

export function isFullWidth(char: string): boolean {
  if (!char) {
    return false;
  }
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2329 && codePoint <= 0x232a) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faf6)
  );
}

export function getDisplayWidth(value: string): number {
  return [...value].reduce((sum, char) => sum + (isFullWidth(char) ? 2 : 1), 0);
}

function cellsToLine(cells: string[]): string {
  let result = "";
  for (const cell of cells) {
    if (cell === "") {
      continue;
    }
    result += cell;
  }
  return result;
}

function lineToCells(line: string, width: number): string[] {
  const cells: string[] = [];
  for (const char of [...line]) {
    cells.push(char);
    if (isFullWidth(char)) {
      cells.push("");
    }
  }
  while (cells.length < width) {
    cells.push(" ");
  }
  if (cells.length > width) {
    return cells.slice(0, width);
  }
  return cells;
}

export class AsciiBuffer {
  private cells: string[][];
  public width: number;
  public height: number;
  public cursor: CursorPos;
  public selection: SelectionRange | null;

  constructor(width = 80, height = 20) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
    this.cursor = { row: 0, col: 0 };
    this.selection = null;
  }

  public static fromText(text: string, minWidth = 80, minHeight = 20): AsciiBuffer {
    const normalized = text.replace(/\r\n/g, "\n");
    const sourceLines = normalized.length > 0 ? normalized.split("\n") : [""];
    const inferredWidth = sourceLines.reduce((max, line) => Math.max(max, getDisplayWidth(line)), 0);
    const buffer = new AsciiBuffer(Math.max(minWidth, inferredWidth), Math.max(minHeight, sourceLines.length));
    sourceLines.forEach((line, row) => {
      buffer.cells[row] = lineToCells(line, buffer.width);
    });
    return buffer;
  }

  public clone(): AsciiBuffer {
    const copy = new AsciiBuffer(this.width, this.height);
    copy.cells = cloneCells(this.cells);
    copy.cursor = { ...this.cursor };
    copy.selection = this.selection
      ? { start: { ...this.selection.start }, end: { ...this.selection.end } }
      : null;
    return copy;
  }

  public getLines(): string[] {
    return this.cells.map((row) => cellsToLine(row));
  }

  public getLine(row: number): string {
    this.ensureSize(row, 0);
    return cellsToLine(this.cells[row]);
  }

  public setSelection(selection: SelectionRange | null): void {
    this.selection = selection
      ? { start: { ...selection.start }, end: { ...selection.end } }
      : null;
  }

  public clearSelection(): void {
    this.selection = null;
  }

  public getNormalizedSelection(selection: SelectionRange | null = this.selection): NormalizedSelection | null {
    if (!selection) {
      return null;
    }
    return {
      top: Math.min(selection.start.row, selection.end.row),
      left: Math.min(selection.start.col, selection.end.col),
      bottom: Math.max(selection.start.row, selection.end.row),
      right: Math.max(selection.start.col, selection.end.col),
    };
  }

  public hasSelection(): boolean {
    const normalized = this.getNormalizedSelection();
    return normalized !== null && (normalized.top !== normalized.bottom || normalized.left !== normalized.right);
  }

  public ensureSize(row: number, col: number): void {
    if (row >= this.height) {
      const extraRows = row + 1 - this.height;
      for (let index = 0; index < extraRows; index += 1) {
        this.cells.push(Array.from({ length: this.width }, () => " "));
      }
      this.height = row + 1;
    }
    if (col >= this.width) {
      const newWidth = col + 1;
      this.cells.forEach((line) => {
        while (line.length < newWidth) {
          line.push(" ");
        }
      });
      this.width = newWidth;
    }
  }

  public getCell(row: number, col: number): string {
    this.ensureSize(row, col);
    return this.cells[row][col] ?? " ";
  }

  public setCell(row: number, col: number, value: string): void {
    this.ensureSize(row, col);
    this.cells[row][col] = value;
  }

  public insertChar(char: string): void {
    if (!char) {
      return;
    }
    const width = isFullWidth(char) ? 2 : 1;
    this.ensureSize(this.cursor.row, this.cursor.col + width - 1);
    this.cells[this.cursor.row][this.cursor.col] = char;
    if (width === 2) {
      this.cells[this.cursor.row][this.cursor.col + 1] = "";
    }
    this.cursor.col += width;
  }

  public writeText(text: string): void {
    for (const char of [...text]) {
      if (char === "\n") {
        this.cursor.row += 1;
        this.cursor.col = 0;
        this.ensureSize(this.cursor.row, this.cursor.col);
        continue;
      }
      this.insertChar(char);
    }
  }

  public deleteForward(): void {
    this.ensureSize(this.cursor.row, this.cursor.col);
    const current = this.cells[this.cursor.row][this.cursor.col];
    this.cells[this.cursor.row][this.cursor.col] = " ";
    if (isFullWidth(current)) {
      this.ensureSize(this.cursor.row, this.cursor.col + 1);
      this.cells[this.cursor.row][this.cursor.col + 1] = " ";
    }
  }

  public deleteBackward(): void {
    if (this.cursor.col === 0 && this.cursor.row === 0) {
      return;
    }
    this.moveCursor("left");
    this.deleteForward();
  }

  public replaceRangeWithSpaces(selection: SelectionRange): void {
    const normalized = this.getNormalizedSelection(selection);
    if (!normalized) {
      return;
    }
    this.ensureSize(normalized.bottom, normalized.right);
    for (let row = normalized.top; row <= normalized.bottom; row += 1) {
      for (let col = normalized.left; col <= normalized.right; col += 1) {
        this.cells[row][col] = " ";
      }
    }
  }

  public getSelectedText(selection: SelectionRange = this.selection ?? { start: this.cursor, end: this.cursor }): string {
    const normalized = this.getNormalizedSelection(selection);
    if (!normalized) {
      return "";
    }
    const lines: string[] = [];
    for (let row = normalized.top; row <= normalized.bottom; row += 1) {
      this.ensureSize(row, normalized.right);
      lines.push(cellsToLine(this.cells[row].slice(normalized.left, normalized.right + 1)).replace(/\s+$/u, ""));
    }
    return lines.join("\n");
  }

  public killLine(): string {
    this.ensureSize(this.cursor.row, this.cursor.col);
    const killed = cellsToLine(this.cells[this.cursor.row].slice(this.cursor.col)).replace(/\s+$/u, "");
    for (let col = this.cursor.col; col < this.width; col += 1) {
      this.cells[this.cursor.row][col] = " ";
    }
    return killed;
  }

  public killSelection(): string {
    const normalized = this.getNormalizedSelection();
    if (!normalized) {
      return "";
    }
    const value = this.getSelectedText();
    this.replaceRangeWithSpaces(this.selection!);
    this.cursor = { row: normalized.top, col: normalized.left };
    this.clearSelection();
    return value;
  }

  public paste(text: string): void {
    this.writeText(text);
  }

  public moveCursor(direction: "left" | "right" | "up" | "down" | "home" | "end"): void {
    switch (direction) {
      case "left":
        if (this.cursor.col > 0) {
          this.cursor.col -= 1;
          while (this.cursor.col > 0 && this.getCell(this.cursor.row, this.cursor.col) === "") {
            this.cursor.col -= 1;
          }
        } else if (this.cursor.row > 0) {
          this.cursor.row -= 1;
          this.cursor.col = Math.max(0, this.width - 1);
        }
        break;
      case "right":
        this.ensureSize(this.cursor.row, this.cursor.col + 1);
        this.cursor.col += 1;
        while (this.cursor.col < this.width && this.getCell(this.cursor.row, this.cursor.col) === "") {
          this.cursor.col += 1;
        }
        if (this.cursor.col >= this.width) {
          this.ensureSize(this.cursor.row, this.cursor.col);
        }
        break;
      case "up":
        if (this.cursor.row > 0) {
          this.cursor.row -= 1;
        }
        break;
      case "down":
        this.cursor.row += 1;
        this.ensureSize(this.cursor.row, this.cursor.col);
        break;
      case "home":
        this.cursor.col = 0;
        break;
      case "end": {
        const line = this.getLine(this.cursor.row).replace(/\s+$/u, "");
        this.cursor.col = getDisplayWidth(line);
        this.ensureSize(this.cursor.row, this.cursor.col);
        break;
      }
    }
  }

  public expandLeft(pad = 1): void {
    if (pad <= 0) {
      return;
    }
    this.cells = this.cells.map((row) => [...Array.from({ length: pad }, () => " "), ...row]);
    this.width += pad;
    this.cursor.col += pad;
    if (this.selection) {
      this.selection.start.col += pad;
      this.selection.end.col += pad;
    }
  }

  public expandTop(pad = 1): void {
    if (pad <= 0) {
      return;
    }
    const rows = Array.from({ length: pad }, () => Array.from({ length: this.width }, () => " "));
    this.cells = [...rows, ...this.cells];
    this.height += pad;
    this.cursor.row += pad;
    if (this.selection) {
      this.selection.start.row += pad;
      this.selection.end.row += pad;
    }
  }

  public toText(): string {
    const lines = this.getLines().map((line) => line.replace(/\s+$/u, ""));
    while (lines.length > 1 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.join("\n");
  }

  public serializeCells(): string[][] {
    return cloneCells(this.cells);
  }

  public restoreCells(cells: string[][]): void {
    this.cells = cloneCells(cells);
    this.height = this.cells.length;
    this.width = this.cells.reduce((max, row) => Math.max(max, row.length), 0);
  }

  public padLine(row: number, width: number): void {
    this.ensureSize(row, width - 1);
  }

  public replaceLine(row: number, line: string): void {
    this.ensureSize(row, getDisplayWidth(line));
    this.cells[row] = lineToCells(line, this.width);
  }

  public getSnapshot(): { cells: string[][]; cursor: CursorPos; selection: SelectionRange | null; width: number; height: number } {
    return {
      cells: this.serializeCells(),
      cursor: { ...this.cursor },
      selection: this.selection ? { start: { ...this.selection.start }, end: { ...this.selection.end } } : null,
      width: this.width,
      height: this.height,
    };
  }

  public restoreSnapshot(snapshot: { cells: string[][]; cursor: CursorPos; selection: SelectionRange | null; width: number; height: number }): void {
    this.cells = cloneCells(snapshot.cells);
    this.cursor = { ...snapshot.cursor };
    this.selection = snapshot.selection ? { start: { ...snapshot.selection.start }, end: { ...snapshot.selection.end } } : null;
    this.width = snapshot.width;
    this.height = snapshot.height;
  }

  public getRowText(row: number, startCol = 0, endCol = this.width - 1): string {
    this.ensureSize(row, endCol);
    return cellsToLine(this.cells[row].slice(startCol, endCol + 1));
  }

  public fillRange(row: number, startCol: number, endCol: number, value: string): void {
    this.ensureSize(row, endCol);
    for (let col = startCol; col <= endCol; col += 1) {
      this.cells[row][col] = value;
    }
  }

  public ensureMarginAround(selection: NormalizedSelection): NormalizedSelection {
    let { top, left, bottom, right } = selection;
    if (top === 0) {
      this.expandTop(1);
      top += 1;
      bottom += 1;
    }
    if (left === 0) {
      this.expandLeft(1);
      left += 1;
      right += 1;
    }
    this.ensureSize(bottom + 1, right + 1);
    return { top, left, bottom, right };
  }

  public getTrimmedContentWidth(top: number, bottom: number, left: number, right: number): number {
    let maxWidth = 0;
    for (let row = top; row <= bottom; row += 1) {
      const rowText = this.getRowText(row, left, right);
      maxWidth = Math.max(maxWidth, getDisplayWidth(rowText.replace(/\s+$/u, "")));
    }
    return maxWidth;
  }

  public insertColumn(at: number, count = 1): void {
    this.cells.forEach((row) => {
      row.splice(at, 0, ...Array.from({ length: count }, () => " "));
    });
    this.width += count;
  }

  public trimTrailingWhitespaceOnRows(): void {
    for (let row = 0; row < this.height; row += 1) {
      const text = this.getLine(row).replace(/\s+$/u, "");
      this.cells[row] = lineToCells(text + repeatSpaces(Math.max(0, this.width - getDisplayWidth(text))), this.width);
    }
  }
}
