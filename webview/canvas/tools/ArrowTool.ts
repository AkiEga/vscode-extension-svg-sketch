import type { Point, DrawStyle, Tool } from "../../shared";
import { ArrowShape, nextId } from "../../shared";
import type { Shape } from "../../shared";
import { DEFAULT_DRAW_STYLE } from "../drawStyle";

export class ArrowTool implements Tool {
  private start: Point | undefined;
  private current: Point | undefined;
  private style: DrawStyle = { ...DEFAULT_DRAW_STYLE, fill: "none" };

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
    return new ArrowShape({
      id: nextId(),
      x1: this.start!.x,
      y1: this.start!.y,
      x2: this.current!.x,
      y2: this.current!.y,
      ...this.style,
    });
  }
}
