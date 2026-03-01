import type { Shape, ShapeType, ToolType, DiagramData } from "../src/types";

// Re-export types for webview modules
export type { Shape, ShapeType, ToolType, DiagramData };

export interface Point {
  x: number;
  y: number;
}

export interface DrawStyle {
  stroke: string;
  fill: string;
  lineWidth: number;
}

export interface Tool {
  onMouseDown(pt: Point, style: DrawStyle): void;
  onMouseMove(pt: Point): void;
  onMouseUp(pt: Point): Shape | undefined;
  /** Preview shape while dragging (optional) */
  getPreview(): Shape | undefined;
}

/** Hit-test: is point inside shape? */
export function hitTest(shape: Shape, pt: Point, tolerance = 6): boolean {
  switch (shape.type) {
    case "rect":
      return (
        pt.x >= shape.x - tolerance &&
        pt.x <= shape.x + shape.width + tolerance &&
        pt.y >= shape.y - tolerance &&
        pt.y <= shape.y + shape.height + tolerance
      );
    case "ellipse": {
      const dx = (pt.x - shape.cx) / (shape.rx + tolerance);
      const dy = (pt.y - shape.cy) / (shape.ry + tolerance);
      return dx * dx + dy * dy <= 1;
    }
    case "arrow": {
      const d = distToSegment(pt, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 });
      return d <= tolerance + shape.lineWidth;
    }
    case "text":
      return (
        pt.x >= shape.x - tolerance &&
        pt.x <= shape.x + shape.text.length * shape.fontSize * 0.6 + tolerance &&
        pt.y >= shape.y - shape.fontSize - tolerance &&
        pt.y <= shape.y + tolerance
      );
  }
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

let _nextId = 1;
export function nextId(): string {
  return `s${_nextId++}`;
}
