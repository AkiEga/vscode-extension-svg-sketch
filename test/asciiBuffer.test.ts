import { describe, expect, it } from "vitest";
import { AsciiBuffer } from "../webview/ascii/AsciiBuffer";

describe("AsciiBuffer", () => {
  it("initializes with 80x20 spaces", () => {
    const buffer = new AsciiBuffer();
    expect(buffer.width).toBe(80);
    expect(buffer.height).toBe(20);
    expect(buffer.getLine(0)).toBe(" ".repeat(80));
  });

  it("replaces one space for half-width input", () => {
    const buffer = new AsciiBuffer(4, 2);
    buffer.insertChar("A");
    expect(buffer.getLine(0).slice(0, 4)).toBe("A   ");
    expect(buffer.cursor.col).toBe(1);
  });

  it("replaces two spaces for full-width input", () => {
    const buffer = new AsciiBuffer(4, 2);
    buffer.insertChar("あ");
    expect(buffer.getLine(0).startsWith("あ")).toBe(true);
    expect(buffer.cursor.col).toBe(2);
  });

  it("expands buffer dynamically", () => {
    const buffer = new AsciiBuffer(2, 2);
    buffer.cursor = { row: 3, col: 3 };
    buffer.insertChar("Z");
    expect(buffer.height).toBeGreaterThanOrEqual(4);
    expect(buffer.width).toBeGreaterThanOrEqual(4);
  });
});
