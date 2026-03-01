import type { Point, DrawStyle, Tool, Shape } from "../../shared";
import { nextId } from "../../shared";
import type { ArrowShape } from "../../../src/types";

export class ArrowTool implements Tool {
  private start: Point | undefined;
  private current: Point | undefined;
  private style: DrawStyle = { stroke: "#000", fill: "none", lineWidth: 2 };

  onMouseDown(pt: Point, style: DrawStyle): void {
    this.start = pt;
    this.current = pt;
    this.style = { ...style, fill: "none" };
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

  private buildShape(): ArrowShape {
    return {
      id: nextId(),
      type: "arrow",
      x1: this.start!.x,
      y1: this.start!.y,
      x2: this.current!.x,
      y2: this.current!.y,
      ...this.style,
    };
  }
}
