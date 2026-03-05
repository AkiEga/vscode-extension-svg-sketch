import type { Point, DrawStyle, Tool, MouseOptions } from "../../shared";
import { Shape, RectShape, EllipseShape, ArrowShape, BubbleShape, TextShape, TableShape, ImageShape } from "../../shared";
import { hitTest } from "../../shared";
import type { Bounds } from "../../shared";

const HANDLE_TOLERANCE = 8;
const BODY_DRAG_THRESHOLD = 6;

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

/** Rubber-band rectangle for marquee selection */
export interface RubberBand {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Compute the 4-corner handle positions for a shape's bounding box */
export function getShapeHandles(shape: Shape): ShapeHandles {
  const b = shape.getBounds();
  const x = b.minX - 4;
  const y = b.minY - 4;
  const w = (b.maxX - b.minX) + 8;
  const h = (b.maxY - b.minY) + 8;
  return {
    tl: { x, y },
    tr: { x: x + w, y },
    bl: { x, y: y + h },
    br: { x: x + w, y: y + h },
  };
}

function nearPoint(a: Point, b: Point, tol: number): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

/** Move a shape by delta, mutating in place */
function moveShapeBy(shape: Shape, dx: number, dy: number): void {
  if (shape instanceof ArrowShape) {
    shape.x1 += dx; shape.y1 += dy;
    shape.x2 += dx; shape.y2 += dy;
  } else if (shape instanceof EllipseShape) {
    shape.cx += dx; shape.cy += dy;
  } else if (shape instanceof RectShape || shape instanceof BubbleShape || shape instanceof TextShape || shape instanceof TableShape || shape instanceof ImageShape) {
    shape.x += dx; shape.y += dy;
  }
}

/** Check if two axis-aligned bounding boxes intersect */
function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function pointInBounds(p: Point, b: Bounds): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

function orientation(a: Point, b: Point, c: Point): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-9) { return 0; }
  return v > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    b.x <= Math.max(a.x, c.x) &&
    b.x >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) &&
    b.y >= Math.min(a.y, c.y)
  );
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) { return true; }
  if (o1 === 0 && onSegment(a1, b1, a2)) { return true; }
  if (o2 === 0 && onSegment(a1, b2, a2)) { return true; }
  if (o3 === 0 && onSegment(b1, a1, b2)) { return true; }
  if (o4 === 0 && onSegment(b1, a2, b2)) { return true; }
  return false;
}

function segmentIntersectsBounds(p1: Point, p2: Point, b: Bounds): boolean {
  if (pointInBounds(p1, b) || pointInBounds(p2, b)) {
    return true;
  }

  const tl = { x: b.minX, y: b.minY };
  const tr = { x: b.maxX, y: b.minY };
  const bl = { x: b.minX, y: b.maxY };
  const br = { x: b.maxX, y: b.maxY };

  return (
    segmentsIntersect(p1, p2, tl, tr) ||
    segmentsIntersect(p1, p2, tr, br) ||
    segmentsIntersect(p1, p2, br, bl) ||
    segmentsIntersect(p1, p2, bl, tl)
  );
}

function expandBounds(b: Bounds, padding: number): Bounds {
  return {
    minX: b.minX - padding,
    minY: b.minY - padding,
    maxX: b.maxX + padding,
    maxY: b.maxY + padding,
  };
}

/** Normalize two points into an axis-aligned bounding box */
function rectFromPoints(a: Point, b: Point): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export class SelectTool implements Tool {
  private shapes: Shape[];
  private _selectedIds: Set<string> = new Set();
  private lastDragPt: Point | undefined;
  private isDraggingBody = false;
  private activeHandle: DragHandleId | undefined;
  /** Snapshot of shape geometry at drag start for proportional resize */
  private dragOrigin: Record<string, number> | undefined;
  private dragStartPt: Point | undefined;
  private undoPushed = false;
  private bodyDragStartPt: Point | undefined;
  private bodyDragMoved = false;
  private pendingSingleSelectId: string | undefined;
  private clickHitShapeId: string | undefined;
  private lastMouseDownShift = false;
  private onSelect: (ids: Set<string>) => void;
  private onUndoPush: () => void;

  // Rubber-band marquee selection
  private rubberBandStart: Point | undefined;
  private rubberBandCurrent: Point | undefined;

  constructor(
    shapes: Shape[],
    onSelect: (ids: Set<string>) => void,
    onUndoPush: () => void = () => {},
  ) {
    this.shapes = shapes;
    this.onSelect = onSelect;
    this.onUndoPush = onUndoPush;
  }

  /** @deprecated Use selectedShapeIds for multi-select */
  get selectedShapeId(): string | undefined {
    if (this._selectedIds.size === 1) { return [...this._selectedIds][0]; }
    return undefined;
  }

  get selectedShapeIds(): Set<string> {
    return new Set(this._selectedIds);
  }

  /** Set selected shape IDs (for external updates like Connect mode) */
  setSelectedIds(ids: Set<string>): void {
    this._selectedIds = new Set(ids);
  }

  /** Get the rubber-band rectangle if currently dragging a marquee */
  getRubberband(): RubberBand | undefined {
    if (!this.rubberBandStart || !this.rubberBandCurrent) { return undefined; }
    const r = rectFromPoints(this.rubberBandStart, this.rubberBandCurrent);
    return { x: r.minX, y: r.minY, width: r.maxX - r.minX, height: r.maxY - r.minY };
  }

  /** Return the handle id if pt is over a handle of the singly-selected shape */
  private hitHandle(pt: Point): DragHandleId | undefined {
    // Handle resize only works with exactly 1 selected shape
    if (this._selectedIds.size !== 1) { return undefined; }
    const id = [...this._selectedIds][0];
    const shape = this.shapes.find((s) => s.id === id);
    if (!shape) { return undefined; }

    // Arrow: check start/end endpoints directly
    if (shape instanceof ArrowShape) {
      if (nearPoint(pt, { x: shape.x1, y: shape.y1 }, HANDLE_TOLERANCE)) { return "start"; }
      if (nearPoint(pt, { x: shape.x2, y: shape.y2 }, HANDLE_TOLERANCE)) { return "end"; }
      return undefined;
    }

    const h = getShapeHandles(shape);
    // Rect, Ellipse, Bubble use only TL/BR handles; others use all 4
    const tlBrOnly = shape instanceof RectShape || shape instanceof EllipseShape || shape instanceof BubbleShape;
    if (nearPoint(pt, h.tl, HANDLE_TOLERANCE)) { return "tl"; }
    if (!tlBrOnly && nearPoint(pt, h.tr, HANDLE_TOLERANCE)) { return "tr"; }
    if (!tlBrOnly && nearPoint(pt, h.bl, HANDLE_TOLERANCE)) { return "bl"; }
    if (nearPoint(pt, h.br, HANDLE_TOLERANCE)) { return "br"; }
    return undefined;
  }

  onMouseDown(pt: Point, _style: DrawStyle, options?: MouseOptions): void {
    this.undoPushed = false;
    this.rubberBandStart = undefined;
    this.rubberBandCurrent = undefined;
    this.isDraggingBody = false;
    this.bodyDragStartPt = undefined;
    this.bodyDragMoved = false;
    this.pendingSingleSelectId = undefined;
    this.clickHitShapeId = undefined;
    const shiftKey = options?.shiftKey ?? false;
    this.lastMouseDownShift = shiftKey;

    // First check if clicking on a handle of the singly-selected shape
    const handle = this.hitHandle(pt);
    if (handle) {
      this.activeHandle = handle;
      this.dragStartPt = { ...pt };
      const id = [...this._selectedIds][0];
      const shape = this.shapes.find((s) => s.id === id)!;
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
      const groupedIds = found.groupId
        ? new Set(this.shapes.filter((s) => s.groupId === found.groupId).map((s) => s.id))
        : new Set<string>([found.id]);
      this.clickHitShapeId = found.id;
      if (shiftKey) {
        // Toggle this shape/group in/out of selection
        const allSelected = [...groupedIds].every((id) => this._selectedIds.has(id));
        if (allSelected) {
          for (const id of groupedIds) {
            this._selectedIds.delete(id);
          }
        } else {
          for (const id of groupedIds) {
            this._selectedIds.add(id);
          }
        }
        this.onSelect(new Set(this._selectedIds));
      } else {
        if (this._selectedIds.size > 1 && this._selectedIds.has(found.id)) {
          // Keep current multi-selection during drag, but collapse to single on click release.
          this.pendingSingleSelectId = found.id;
        } else {
          this._selectedIds.clear();
          for (const id of groupedIds) {
            this._selectedIds.add(id);
          }
          this.onSelect(new Set(this._selectedIds));
        }
      }
      // Setup for body drag
      this.lastDragPt = { ...pt };
      this.bodyDragStartPt = { ...pt };
      this.isDraggingBody = true;
    } else {
      if (!shiftKey) {
        this._selectedIds.clear();
        this.onSelect(new Set(this._selectedIds));
      }
      this.lastDragPt = undefined;
      // Start rubber-band selection
      this.rubberBandStart = { ...pt };
      this.rubberBandCurrent = { ...pt };
    }
  }

  onMouseMove(pt: Point): void {
    // Rubber-band mode
    if (this.rubberBandStart) {
      this.rubberBandCurrent = { ...pt };
      return;
    }

    if (this._selectedIds.size === 0) { return; }

    // Handle resize (single shape only)
    if (this.activeHandle && this.dragOrigin && this.dragStartPt) {
      if (!this.undoPushed) {
        this.undoPushed = true;
        this.onUndoPush();
      }
      const id = [...this._selectedIds][0];
      const shape = this.shapes.find((s) => s.id === id);
      if (shape) { this.applyHandleDrag(shape, pt); }
      return;
    }

    // Body move: move all selected shapes
    if (!this.isDraggingBody || !this.lastDragPt) { return; }
    if (!this.bodyDragMoved && this.bodyDragStartPt) {
      const dist = Math.hypot(pt.x - this.bodyDragStartPt.x, pt.y - this.bodyDragStartPt.y);
      if (dist < BODY_DRAG_THRESHOLD) {
        return;
      }
      this.bodyDragMoved = true;
      this.pendingSingleSelectId = undefined;
    }
    if (!this.undoPushed) {
      this.undoPushed = true;
      this.onUndoPush();
    }

    const dx = pt.x - this.lastDragPt.x;
    const dy = pt.y - this.lastDragPt.y;

    for (const id of this._selectedIds) {
      const shape = this.shapes.find((s) => s.id === id);
      if (shape) { moveShapeBy(shape, dx, dy); }
    }
    this.lastDragPt = { ...pt };
  }

  onMouseUp(pt: Point): Shape | undefined {
    // Rubber-band: select shapes whose bounds intersect
    if (this.rubberBandStart) {
      const rect = rectFromPoints(this.rubberBandStart, pt);
      const hasArea = (rect.maxX - rect.minX) > 2 || (rect.maxY - rect.minY) > 2;
      if (hasArea) {
        for (const s of this.shapes) {
          if (s instanceof ArrowShape) {
            const padded = expandBounds(rect, Math.max(4, s.lineWidth / 2));
            const intersects = segmentIntersectsBounds(
              { x: s.x1, y: s.y1 },
              { x: s.x2, y: s.y2 },
              padded,
            );
            if (intersects) {
              this._selectedIds.add(s.id);
            }
            continue;
          }
          if (boundsIntersect(s.getBounds(), rect)) {
            this._selectedIds.add(s.id);
          }
        }
        this.onSelect(new Set(this._selectedIds));
      }
      this.rubberBandStart = undefined;
      this.rubberBandCurrent = undefined;
      return undefined;
    }

    if (!this.bodyDragMoved && !this.lastMouseDownShift && this.clickHitShapeId) {
      const singleId = this.pendingSingleSelectId ?? this.clickHitShapeId;
      this._selectedIds.clear();
      this._selectedIds.add(singleId);
      this.onSelect(new Set(this._selectedIds));
    }

    this.lastDragPt = undefined;
    this.isDraggingBody = false;
    this.activeHandle = undefined;
    this.dragOrigin = undefined;
    this.dragStartPt = undefined;
    this.bodyDragStartPt = undefined;
    this.bodyDragMoved = false;
    this.pendingSingleSelectId = undefined;
    this.clickHitShapeId = undefined;
    this.lastMouseDownShift = false;
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
    if (shape instanceof RectShape) {
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    }
    if (shape instanceof EllipseShape) {
      return { cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry };
    }
    if (shape instanceof ArrowShape) {
      return { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 };
    }
    if (shape instanceof TableShape) {
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    }
    if (shape instanceof BubbleShape) {
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    }
    if (shape instanceof ImageShape) {
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    }
    return {};
  }

  private applyHandleDrag(shape: Shape, pt: Point): void {
    const o = this.dragOrigin!;
    const handle = this.activeHandle!;

    if (shape instanceof ArrowShape) {
      if (handle === "start") { shape.x1 = pt.x; shape.y1 = pt.y; }
      else if (handle === "end") { shape.x2 = pt.x; shape.y2 = pt.y; }
      return;
    }

    if (shape.type === "rect" || shape.type === "bubble" || shape.type === "table" || shape.type === "image") {
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
      (shape as Record<string, unknown>).x = newX;
      (shape as Record<string, unknown>).y = newY;
      (shape as Record<string, unknown>).width = newW;
      (shape as Record<string, unknown>).height = newH;
      return;
    }

    if (shape.type === "ellipse") {
      const es = shape as EllipseShape;
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
      es.rx = newW / 2;
      es.ry = newH / 2;
      es.cx = newX + newW / 2;
      es.cy = newY + newH / 2;
      return;
    }
  }
}
