import { AsciiBuffer, type CursorPos, type NormalizedSelection, type SelectionRange } from "./AsciiBuffer";

export interface BoxBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

function rewriteHorizontal(buffer: AsciiBuffer, row: number, left: number, right: number): void {
  buffer.setCell(row, left, "+");
  for (let col = left + 1; col < right; col += 1) {
    buffer.setCell(row, col, "-");
  }
  buffer.setCell(row, right, "+");
}

function normalize(buffer: AsciiBuffer, selection: SelectionRange): NormalizedSelection {
  const normalized = buffer.getNormalizedSelection(selection);
  if (!normalized) {
    throw new Error("Selection is required");
  }
  return normalized;
}

export function getBoxBounds(buffer: AsciiBuffer, selection: SelectionRange): BoxBounds {
  const base = buffer.ensureMarginAround(normalize(buffer, selection));
  return {
    top: base.top - 1,
    left: base.left - 1,
    bottom: base.bottom + 1,
    right: base.right + 1,
  };
}

export function isBoxed(buffer: AsciiBuffer, selection: SelectionRange): boolean {
  const normalized = buffer.getNormalizedSelection(selection);
  if (!normalized) {
    return false;
  }
  const top = normalized.top - 1;
  const left = normalized.left - 1;
  const bottom = normalized.bottom + 1;
  const right = normalized.right + 1;
  if (top < 0 || left < 0) {
    return false;
  }
  if (buffer.getCell(top, left) !== "+" || buffer.getCell(top, right) !== "+") {
    return false;
  }
  if (buffer.getCell(bottom, left) !== "+" || buffer.getCell(bottom, right) !== "+") {
    return false;
  }
  for (let col = left + 1; col < right; col += 1) {
    if (buffer.getCell(top, col) !== "-" || buffer.getCell(bottom, col) !== "-") {
      return false;
    }
  }
  for (let row = top + 1; row < bottom; row += 1) {
    if (buffer.getCell(row, left) !== "|" || buffer.getCell(row, right) !== "|") {
      return false;
    }
  }
  return true;
}

export function addBox(buffer: AsciiBuffer, selection: SelectionRange): BoxBounds {
  const bounds = getBoxBounds(buffer, selection);
  buffer.ensureSize(bounds.bottom, bounds.right);
  rewriteHorizontal(buffer, bounds.top, bounds.left, bounds.right);
  rewriteHorizontal(buffer, bounds.bottom, bounds.left, bounds.right);
  for (let row = bounds.top + 1; row < bounds.bottom; row += 1) {
    buffer.setCell(row, bounds.left, "|");
    buffer.setCell(row, bounds.right, "|");
  }
  return bounds;
}

export function removeBox(buffer: AsciiBuffer, selection: SelectionRange): void {
  if (!isBoxed(buffer, selection)) {
    return;
  }
  const normalized = normalize(buffer, selection);
  const top = normalized.top - 1;
  const left = normalized.left - 1;
  const bottom = normalized.bottom + 1;
  const right = normalized.right + 1;
  for (let col = left; col <= right; col += 1) {
    buffer.setCell(top, col, " ");
    buffer.setCell(bottom, col, " ");
  }
  for (let row = top + 1; row < bottom; row += 1) {
    buffer.setCell(row, left, " ");
    buffer.setCell(row, right, " ");
  }
}

export function toggleBox(buffer: AsciiBuffer, selection: SelectionRange): BoxBounds | null {
  if (isBoxed(buffer, selection)) {
    removeBox(buffer, selection);
    return null;
  }
  return addBox(buffer, selection);
}

export function findContainingBox(buffer: AsciiBuffer, cursor: CursorPos): BoxBounds | null {
  const rowText = buffer.getLine(cursor.row);
  const left = rowText.lastIndexOf("|", cursor.col);
  const right = rowText.indexOf("|", cursor.col);
  if (left < 0 || right < 0 || left === right) {
    return null;
  }
  let top = cursor.row - 1;
  while (top >= 0) {
    if (buffer.getCell(top, left) === "+" && buffer.getCell(top, right) === "+") {
      break;
    }
    top -= 1;
  }
  let bottom = cursor.row + 1;
  while (bottom < buffer.height) {
    if (buffer.getCell(bottom, left) === "+" && buffer.getCell(bottom, right) === "+") {
      break;
    }
    bottom += 1;
  }
  if (top < 0 || bottom >= buffer.height) {
    return null;
  }
  return { top, left, bottom, right };
}

export function autoAdjustBox(buffer: AsciiBuffer, box: BoxBounds): BoxBounds {
  const contentWidth = Math.max(1, buffer.getTrimmedContentWidth(box.top + 1, box.bottom - 1, box.left + 1, buffer.width - 1));
  const newRight = box.left + contentWidth + 1;
  buffer.ensureSize(box.bottom, newRight);
  const oldRight = box.right;
  if (newRight < oldRight) {
    for (let row = box.top; row <= box.bottom; row += 1) {
      for (let col = newRight + 1; col <= oldRight; col += 1) {
        buffer.setCell(row, col, " ");
      }
    }
  }
  rewriteHorizontal(buffer, box.top, box.left, newRight);
  rewriteHorizontal(buffer, box.bottom, box.left, newRight);
  for (let row = box.top + 1; row < box.bottom; row += 1) {
    buffer.setCell(row, box.left, "|");
    if (oldRight !== newRight) {
      buffer.setCell(row, oldRight, " ");
    }
    buffer.setCell(row, newRight, "|");
  }
  return { ...box, right: newRight };
}
