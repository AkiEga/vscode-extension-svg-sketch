import type { Point, DrawStyle, Tool, Shape } from "../../shared";
import { nextId } from "../../shared";
import type { EllipseShape } from "../../../src/types";

export class EllipseTool implements Tool {
  private start: Point | undefined;
  private current: Point | undefined;
  private style: DrawStyle = { stroke: "#000", fill: "#fff", lineWidth: 2 };

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
    const shape = this.buildShape();
    this.start = undefined;
    this.current = undefined;
    return shape;
  }

  getPreview(): Shape | undefined {
    if (!this.start || !this.current) { return undefined; }
    return this.buildShape();
  }

  private buildShape(): EllipseShape {
    const s = this.start!;
    const c = this.current!;
    return {
      id: nextId(),
      type: "ellipse",
      cx: (s.x + c.x) / 2,
      cy: (s.y + c.y) / 2,
      rx: Math.abs(c.x - s.x) / 2,
      ry: Math.abs(c.y - s.y) / 2,
      ...this.style,
    };
  }
}
