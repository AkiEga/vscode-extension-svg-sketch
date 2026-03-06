export enum EndOfLine {
  LF = 1,
  CRLF = 2,
}

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}

  public translate(lineDelta = 0, characterDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }
}

export class Range {
  constructor(public readonly start: Position, public readonly end: Position) {}
}
