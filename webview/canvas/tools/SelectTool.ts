import type { Point, DrawStyle, Tool, Shape } from "../../shared";
import { hitTest } from "../../shared";

const HANDLE_TOLERANCE = 8;

/** Handle positions for a shape's bounding box: TL, TR, BL, BR */
export type HandleId = "tl" | "tr" | "bl" | "br";

/** For arrows the handles are start/end endpoints */
export type ArrowHandleId = "start" | "end";

export type DragHandleId = HandleId | ArrowHandleId;

export interface ShapeHandles {
  tl: Point;
  tr: Point;
  bl: Point;
  br: Point;
}

/** Compute the 4-corner handle positions for a shape's bounding box */
export function getShapeHandles(shape: Shape): ShapeHandles {
  let x: number, y: number, w: number, h: number;
  switch (shape.type) {
    case "rect":
      x = shape.x - 4; y = shape.y - 4;
      w = shape.width + 8; h = shape.height + 8;
      break;
    case "ellipse":
      x = shape.cx - shape.rx - 4; y = shape.cy - shape.ry - 4;
      w = shape.rx * 2 + 8; h = shape.ry * 2 + 8;
      break;
    case "arrow": {
      const minX = Math.min(shape.x1, shape.x2);
      const minY = Math.min(shape.y1, shape.y2);
      x = minX - 4; y = minY - 4;
      w = Math.abs(shape.x2 - shape.x1) + 8;
      h = Math.abs(shape.y2 - shape.y1) + 8;
      break;
    }
    case "text":
      x = shape.x - 4; y = shape.y - shape.fontSize - 4;
      w = shape.text.length * shape.fontSize * 0.6 + 8;
      h = shape.fontSize + 8;
      break;
    case "table":
      x = shape.x - 4; y = shape.y - 4;
      w = shape.width + 8; h = shape.height + 8;
      break;
  }
  return {
    tl: { x: x!, y: y! },
    tr: { x: x! + w!, y: y! },
    bl: { x: x!, y: y! + h! },
    br: { x: x! + w!, y: y! + h! },
  };
}

function nearPoint(a: Point, b: Point, tol: number): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

export class SelectTool implements Tool {
  private shapes: Shape[];
  private selectedId: string | undefined;
  private dragOffset: Point | undefined;
  private activeHandle: DragHandleId | undefined;
  /** Snapshot of shape geometry at drag start for proportional resize */
  private dragOrigin: Record<string, number> | undefined;
  private dragStartPt: Point | undefined;
  private undoPushed = false;
  private onSelect: (id: string | undefined) => void;
  private onUndoPush: () => void;

  constructor(
    shapes: Shape[],
    onSelect: (id: string | undefined) => void,
    onUndoPush: () => void = () => {},
  ) {
    this.shapes = shapes;
    this.onSelect = onSelect;
    this.onUndoPush = onUndoPush;
  }

  get selectedShapeId(): string | undefined {
    return this.selectedId;
  }

  /** Return the handle id if pt is over a handle of the currently-selected shape */
  private hitHandle(pt: Point): DragHandleId | undefined {
    if (!this.selectedId) { return undefined; }
    const shape = this.shapes.find((s) => s.id === this.selectedId);
    if (!shape) { return undefined; }

    // Arrow: check start/end endpoints directly
    if (shape.type === "arrow") {
      if (nearPoint(pt, { x: shape.x1, y: shape.y1 }, HANDLE_TOLERANCE)) { return "start"; }
      if (nearPoint(pt, { x: shape.x2, y: shape.y2 }, HANDLE_TOLERANCE)) { return "end"; }
      return undefined;
    }

    const h = getShapeHandles(shape);
    if (nearPoint(pt, h.tl, HANDLE_TOLERANCE)) { return "tl"; }
    if (nearPoint(pt, h.tr, HANDLE_TOLERANCE)) { return "tr"; }
    if (nearPoint(pt, h.bl, HANDLE_TOLERANCE)) { return "bl"; }
    if (nearPoint(pt, h.br, HANDLE_TOLERANCE)) { return "br"; }
    return undefined;
  }

  onMouseDown(pt: Point, _style: DrawStyle): void {
    this.undoPushed = false;

    // First check if clicking on a handle of the already-selected shape
    const handle = this.hitHandle(pt);
    if (handle) {
      this.activeHandle = handle;
      this.dragStartPt = { ...pt };
      const shape = this.shapes.find((s) => s.id === this.selectedId)!;
      this.dragOrigin = this.snapshotGeometry(shape);
      return;
    }

    this.activeHandle = undefined;
    this.dragOrigin = undefined;
    this.dragStartPt = undefined;

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
    if (!this.selectedId) { return; }
    const shape = this.shapes.find((s) => s.id === this.selectedId);
    if (!shape) { return; }

    // Handle resize
    if (this.activeHandle && this.dragOrigin && this.dragStartPt) {
      if (!this.undoPushed) {
        this.undoPushed = true;
        this.onUndoPush();
      }
      this.applyHandleDrag(shape, pt);
      return;
    }

    // Body move
    if (!this.dragOffset) { return; }
    if (!this.undoPushed) {
      this.undoPushed = true;
      this.onUndoPush();
    }

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
      case "table":
        shape.x = nx;
        shape.y = ny;
        break;
    }
  }

  onMouseUp(_pt: Point): Shape | undefined {
    this.dragOffset = undefined;
    this.activeHandle = undefined;
    this.dragOrigin = undefined;
    this.dragStartPt = undefined;
    return undefined; // select tool doesn't create shapes
  }

  getPreview(): Shape | undefined {
    return undefined;
  }

  /** Get cursor style hint for a point (used by CanvasEditor) */
  getCursorAt(pt: Point): string | undefined {
    const handle = this.hitHandle(pt);
    if (!handle) { return undefined; }
    switch (handle) {
      case "tl": case "br": return "nwse-resize";
      case "tr": case "bl": return "nesw-resize";
      case "start": case "end": return "crosshair";
    }
  }

  // --- private helpers ---

  private snapshotGeometry(shape: Shape): Record<string, number> {
    switch (shape.type) {
      case "rect":
        return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      case "ellipse":
        return { cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry };
      case "arrow":
        return { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 };
      case "table":
        return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      default:
        return {};
    }
  }

  private applyHandleDrag(shape: Shape, pt: Point): void {
    const o = this.dragOrigin!;
    const handle = this.activeHandle!;

    if (shape.type === "arrow") {
      if (handle === "start") { shape.x1 = pt.x; shape.y1 = pt.y; }
      else if (handle === "end") { shape.x2 = pt.x; shape.y2 = pt.y; }
      return;
    }

    if (shape.type === "rect" || shape.type === "table") {
      let newX = o.x, newY = o.y, newW = o.width, newH = o.height;
      switch (handle) {
        case "tl":
          newW = o.x + o.width - pt.x;
          newH = o.y + o.height - pt.y;
          newX = pt.x; newY = pt.y;
          break;
        case "tr":
          newW = pt.x - o.x;
          newH = o.y + o.height - pt.y;
          newY = pt.y;
          break;
        case "bl":
          newW = o.x + o.width - pt.x;
          newH = pt.y - o.y;
          newX = pt.x;
          break;
        case "br":
          newW = pt.x - o.x;
          newH = pt.y - o.y;
          break;
      }
      // Enforce minimum size
      if (newW < 10) { newW = 10; if (handle === "tl" || handle === "bl") { newX = o.x + o.width - 10; } }
      if (newH < 10) { newH = 10; if (handle === "tl" || handle === "tr") { newY = o.y + o.height - 10; } }
      shape.x = newX; shape.y = newY;
      (shape as { width: number }).width = newW;
      (shape as { height: number }).height = newH;
      return;
    }

    if (shape.type === "ellipse") {
      // Treat bounding box like a rect, derive cx/cy/rx/ry
      const bx = o.cx - o.rx, by = o.cy - o.ry;
      const bw = o.rx * 2, bh = o.ry * 2;
      let newX = bx, newY = by, newW = bw, newH = bh;
      switch (handle) {
        case "tl": newW = bx + bw - pt.x; newH = by + bh - pt.y; newX = pt.x; newY = pt.y; break;
        case "tr": newW = pt.x - bx; newH = by + bh - pt.y; newY = pt.y; break;
        case "bl": newW = bx + bw - pt.x; newH = pt.y - by; newX = pt.x; break;
        case "br": newW = pt.x - bx; newH = pt.y - by; break;
      }
      if (newW < 10) { newW = 10; if (handle === "tl" || handle === "bl") { newX = bx + bw - 10; } }
      if (newH < 10) { newH = 10; if (handle === "tl" || handle === "tr") { newY = by + bh - 10; } }
      shape.rx = newW / 2;
      shape.ry = newH / 2;
      shape.cx = newX + newW / 2;
      shape.cy = newY + newH / 2;
      return;
    }
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
    case "table":
      return { x: shape.x, y: shape.y };
  }
}
