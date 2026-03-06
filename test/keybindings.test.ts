import { describe, expect, it } from "vitest";
import { AsciiBuffer } from "../webview/ascii/AsciiBuffer";

describe("keybinding behaviors", () => {
  it("moves to line end using logical text width", () => {
    const buffer = AsciiBuffer.fromText("ab", 10, 4);
    buffer.moveCursor("end");
    expect(buffer.cursor.col).toBe(2);
  });

  it("kills selection and returns clipboard text", () => {
    const buffer = AsciiBuffer.fromText("abcd", 10, 4);
    buffer.setSelection({ start: { row: 0, col: 1 }, end: { row: 0, col: 2 } });
    expect(buffer.killSelection()).toBe("bc");
  });
});
