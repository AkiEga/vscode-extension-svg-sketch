import type { Point, DrawStyle, Tool } from "../../shared";
import { EllipseShape, nextId } from "../../shared";
import type { Shape } from "../../shared";
import { DEFAULT_DRAW_STYLE } from "../drawStyle";

export class EllipseTool implements Tool {
  private start: Point | undefined;
  private current: Point | undefined;
  private style: DrawStyle = { ...DEFAULT_DRAW_STYLE };

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
    return new EllipseShape({
      id: nextId(),
      cx: (s.x + c.x) / 2,
      cy: (s.y + c.y) / 2,
      rx: Math.abs(c.x - s.x) / 2,
      ry: Math.abs(c.y - s.y) / 2,
      ...this.style,
    });
  }
}
