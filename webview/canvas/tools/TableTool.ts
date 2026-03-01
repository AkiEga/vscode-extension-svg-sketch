import type { Point, DrawStyle, Tool, Shape } from "../../shared";
import { nextId } from "../../shared";
import type { TableShape } from "../../../src/types";

export type TableConfigRequest = {
  pt: Point;
  width: number;
  height: number;
  style: DrawStyle;
};

export class TableTool implements Tool {
  private start: Point | undefined;
  private current: Point | undefined;
  private style: DrawStyle = { stroke: "#000", fill: "#fff", lineWidth: 2 };
  private _onTableRequest: ((req: TableConfigRequest) => void) | undefined;

  set onTableRequest(cb: (req: TableConfigRequest) => void) {
    this._onTableRequest = cb;
  }

  onMouseDown(pt: Point, style: DrawStyle): void {
    this.start = pt;
    this.current = pt;
    this.style = { ...style };
  }

  onMouseMove(pt: Point): void {
    this.current = pt;
  }

  onMouseUp(_pt: Point): Shape | undefined {
    if (!this.start || !this.current) { return undefined; }

    const s = this.start;
    const c = this.current;
    const x = Math.min(s.x, c.x);
    const y = Math.min(s.y, c.y);
    const width = Math.max(Math.abs(c.x - s.x), 120);
    const height = Math.max(Math.abs(c.y - s.y), 80);

    this.start = undefined;
    this.current = undefined;

    if (this._onTableRequest) {
      this._onTableRequest({ pt: { x, y }, width, height, style: { ...this.style } });
      return undefined;
    }

    return TableTool.createShape({ x, y }, width, height, this.style, 3, 3);
  }

  getPreview(): Shape | undefined {
    if (!this.start || !this.current) { return undefined; }
    const s = this.start;
    const c = this.current;
    return {
      id: "preview",
      type: "table",
      x: Math.min(s.x, c.x),
      y: Math.min(s.y, c.y),
      width: Math.max(Math.abs(c.x - s.x), 120),
      height: Math.max(Math.abs(c.y - s.y), 80),
      rows: 3,
      cols: 3,
      cells: [["H1", "H2", "H3"], ["", "", ""], ["", "", ""]],
      fontSize: 12,
      ...this.style,
    };
  }

  static createShape(
    pt: Point,
    width: number,
    height: number,
    style: DrawStyle,
    rows: number,
    cols: number,
  ): TableShape {
    const cells: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let col = 0; col < cols; col++) {
        row.push(r === 0 ? `H${col + 1}` : "");
      }
      cells.push(row);
    }

    return {
      id: nextId(),
      type: "table",
      x: pt.x,
      y: pt.y,
      width: Math.max(width, cols * 60),
      height: Math.max(height, rows * 28),
      rows,
      cols,
      cells,
      fontSize: 12,
      ...style,
    };
  }
}
