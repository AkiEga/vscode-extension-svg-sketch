import { describe, expect, it } from "vitest";
import { AsciiBuffer } from "../webview/ascii/AsciiBuffer";
import { addBox, autoAdjustBox, isBoxed, removeBox } from "../webview/ascii/BoxDrawing";

describe("BoxDrawing", () => {
  it("adds and removes a box without moving text", () => {
    const buffer = AsciiBuffer.fromText("text", 10, 5);
    buffer.setSelection({ start: { row: 1, col: 1 }, end: { row: 1, col: 4 } });
    addBox(buffer, buffer.selection!);
    expect(isBoxed(buffer, buffer.selection!)).toBe(true);
    removeBox(buffer, buffer.selection!);
    expect(isBoxed(buffer, buffer.selection!)).toBe(false);
  });

  it("expands a box when content grows", () => {
    const buffer = AsciiBuffer.fromText("hello", 12, 6);
    buffer.setSelection({ start: { row: 1, col: 1 }, end: { row: 1, col: 5 } });
    const box = addBox(buffer, buffer.selection!);
    buffer.cursor = { row: 1, col: 6 };
    buffer.insertChar("!");
    const adjusted = autoAdjustBox(buffer, box);
    expect(adjusted.right).toBeGreaterThan(box.right);
  });
});
