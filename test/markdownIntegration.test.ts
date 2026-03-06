import { describe, expect, it } from "vitest";
import {
  findAsciiBlock,
  findEditingPlaceholder,
  formatAsciiBlock,
  formatEditingPlaceholder,
  parseEditingPlaceholderId,
} from "../src/markdownIntegration";

enum EndOfLine {
  LF = 1,
  CRLF = 2,
}

class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

type TestDocument = {
  eol: EndOfLine;
  getText: () => string;
  offsetAt: (position: Position) => number;
  positionAt: (offset: number) => Position;
};

function createDocument(text: string, eol = EndOfLine.LF): TestDocument {
  return {
    eol,
    getText: () => text,
    offsetAt: (position: Position) => {
      const lines = text.split(/\r?\n/);
      let offset = 0;
      for (let index = 0; index < position.line; index++) {
        offset += lines[index]?.length ?? 0;
        offset += eol === EndOfLine.CRLF ? 2 : 1;
      }
      return offset + position.character;
    },
    positionAt: (offset: number) => {
      const normalized = eol === EndOfLine.CRLF ? text.replace(/\r\n/g, "\n") : text;
      const clampedOffset = Math.max(0, Math.min(offset, normalized.length));
      const prefix = normalized.slice(0, clampedOffset);
      const lines = prefix.split("\n");
      return new Position(lines.length - 1, lines.at(-1)?.length ?? 0);
    },
  };
}

describe("markdownIntegration", () => {
  it("formats an ascii block", () => {
    expect(formatAsciiBlock("abc")).toBe("```ascii-sketch\nabc\n```");
  });

  it("formats an editing placeholder", () => {
    expect(formatEditingPlaceholder("deadbeef")).toBe("```ascii-sketch\nEditing... (id: deadbeef)\n```");
  });

  it("finds a block at cursor position", () => {
    const text = "before\n```ascii-sketch\nabc\n```\nafter";
    const document = createDocument(text);
    const match = findAsciiBlock(document as never, new Position(2, 0) as never);
    expect(match?.content).toBe("abc");
  });

  it("finds an editing placeholder by id in a CRLF document", () => {
    const text = "before\r\n```ascii-sketch\r\nEditing... (id: deadbeef)\r\n```\r\nafter";
    const document = createDocument(text, EndOfLine.CRLF);
    const match = findEditingPlaceholder(document as never, "deadbeef");
    expect(match?.content).toBe("Editing... (id: deadbeef)");
  });

  it("parses placeholder ids", () => {
    expect(parseEditingPlaceholderId("Editing... (id: deadbeef)")).toBe("deadbeef");
    expect(parseEditingPlaceholderId("abc")).toBeUndefined();
  });
});
