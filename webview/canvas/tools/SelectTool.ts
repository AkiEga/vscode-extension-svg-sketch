import type { Point, DrawStyle, Tool, Shape } from "../../shared";
import { hitTest } from "../../shared";

export class SelectTool implements Tool {
  private shapes: Shape[];
  private selectedId: string | undefined;
  private dragOffset: Point | undefined;
  private onSelect: (id: string | undefined) => void;

  constructor(shapes: Shape[], onSelect: (id: string | undefined) => void) {
    this.shapes = shapes;
    this.onSelect = onSelect;
  }

  get selectedShapeId(): string | undefined {
    return this.selectedId;
  }

  onMouseDown(pt: Point, _style: DrawStyle): void {
    // Find topmost shape under cursor (iterate in reverse)
    let found: Shape | undefined;
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      if (hitTest(this.shapes[i], pt)) {
        found = this.shapes[i];
        break;
      }
    }

    if (found) {
      this.selectedId = found.id;
      this.onSelect(found.id);
      // Calculate offset for dragging
      const origin = getShapeOrigin(found);
      this.dragOffset = { x: pt.x - origin.x, y: pt.y - origin.y };
    } else {
      this.selectedId = undefined;
      this.dragOffset = undefined;
      this.onSelect(undefined);
    }
  }

  onMouseMove(pt: Point): void {
    if (!this.selectedId || !this.dragOffset) { return; }
    const shape = this.shapes.find((s) => s.id === this.selectedId);
    if (!shape) { return; }

    const nx = pt.x - this.dragOffset.x;
    const ny = pt.y - this.dragOffset.y;

    switch (shape.type) {
      case "rect":
        shape.x = nx;
        shape.y = ny;
        break;
      case "ellipse":
        shape.cx = nx;
        shape.cy = ny;
        break;
      case "arrow": {
        const dx = nx - shape.x1;
        const dy = ny - shape.y1;
        shape.x1 += dx;
        shape.y1 += dy;
        shape.x2 += dx;
        shape.y2 += dy;
        // Update offset for next move
        this.dragOffset = { x: pt.x - shape.x1, y: pt.y - shape.y1 };
        break;
      }
      case "text":
        shape.x = nx;
        shape.y = ny;
        break;
    }
  }

  onMouseUp(_pt: Point): Shape | undefined {
    this.dragOffset = undefined;
    return undefined; // select tool doesn't create shapes
  }

  getPreview(): Shape | undefined {
    return undefined;
  }
}

function getShapeOrigin(shape: Shape): Point {
  switch (shape.type) {
    case "rect":
      return { x: shape.x, y: shape.y };
    case "ellipse":
      return { x: shape.cx, y: shape.cy };
    case "arrow":
      return { x: shape.x1, y: shape.y1 };
    case "text":
      return { x: shape.x, y: shape.y };
  }
}
