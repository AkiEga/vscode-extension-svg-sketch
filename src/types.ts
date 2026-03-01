/** Supported shape types */
export type ShapeType = "rect" | "ellipse" | "arrow" | "bubble" | "text" | "table";

/** A 2D point */
export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned bounding box */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Abstract base class for all shapes */
export abstract class Shape {
  id: string;
  abstract readonly type: ShapeType;
  stroke: string;
  fill: string;
  lineWidth: number;
  groupId?: string;

  constructor(id: string, stroke: string, fill: string, lineWidth: number, groupId?: string) {
    this.id = id;
    this.stroke = stroke;
    this.fill = fill;
    this.lineWidth = lineWidth;
    this.groupId = groupId;
  }

  /** Create a deep copy; optionally assign a new id */
  abstract clone(newId?: string): Shape;

  /** Test whether a point is inside / near this shape */
  abstract hitTest(pt: Point, tolerance?: number): boolean;

  /** Axis-aligned bounding box */
  abstract getBounds(): Bounds;

  /** Primary origin point (used as drag anchor) */
  abstract getOrigin(): Point;

  /** Return a translated copy */
  abstract translate(dx: number, dy: number): Shape;
}

export class RectShape extends Shape {
  readonly type = "rect" as const;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  labelFontSize?: number;

  constructor(data: { id: string; x: number; y: number; width: number; height: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x = data.x;
    this.y = data.y;
    this.width = data.width;
    this.height = data.height;
    this.label = data.label;
    this.labelFontSize = data.labelFontSize;
  }

  clone(newId?: string): RectShape {
    return new RectShape({ id: newId ?? this.id, x: this.x, y: this.y, width: this.width, height: this.height, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, groupId: this.groupId });
  }

  hitTest(pt: Point, tolerance = 6): boolean {
    return (
      pt.x >= this.x - tolerance &&
      pt.x <= this.x + this.width + tolerance &&
      pt.y >= this.y - tolerance &&
      pt.y <= this.y + this.height + tolerance
    );
  }

  getBounds(): Bounds {
    return { minX: this.x, minY: this.y, maxX: this.x + this.width, maxY: this.y + this.height };
  }

  getOrigin(): Point { return { x: this.x, y: this.y }; }

  translate(dx: number, dy: number): RectShape {
    return new RectShape({ id: this.id, x: this.x + dx, y: this.y + dy, width: this.width, height: this.height, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, groupId: this.groupId });
  }
}

export class EllipseShape extends Shape {
  readonly type = "ellipse" as const;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  label?: string;
  labelFontSize?: number;

  constructor(data: { id: string; cx: number; cy: number; rx: number; ry: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.cx = data.cx;
    this.cy = data.cy;
    this.rx = data.rx;
    this.ry = data.ry;
    this.label = data.label;
    this.labelFontSize = data.labelFontSize;
  }

  clone(newId?: string): EllipseShape {
    return new EllipseShape({ id: newId ?? this.id, cx: this.cx, cy: this.cy, rx: this.rx, ry: this.ry, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, groupId: this.groupId });
  }

  hitTest(pt: Point, tolerance = 6): boolean {
    const dx = (pt.x - this.cx) / (this.rx + tolerance);
    const dy = (pt.y - this.cy) / (this.ry + tolerance);
    return dx * dx + dy * dy <= 1;
  }

  getBounds(): Bounds {
    return { minX: this.cx - this.rx, minY: this.cy - this.ry, maxX: this.cx + this.rx, maxY: this.cy + this.ry };
  }

  getOrigin(): Point { return { x: this.cx, y: this.cy }; }

  translate(dx: number, dy: number): EllipseShape {
    return new EllipseShape({ id: this.id, cx: this.cx + dx, cy: this.cy + dy, rx: this.rx, ry: this.ry, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, groupId: this.groupId });
  }
}

export class ArrowShape extends Shape {
  readonly type = "arrow" as const;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  labelFontSize?: number;

  constructor(data: { id: string; x1: number; y1: number; x2: number; y2: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x1 = data.x1;
    this.y1 = data.y1;
    this.x2 = data.x2;
    this.y2 = data.y2;
    this.label = data.label;
    this.labelFontSize = data.labelFontSize;
  }

  clone(newId?: string): ArrowShape {
    return new ArrowShape({ id: newId ?? this.id, x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, groupId: this.groupId });
  }

  hitTest(pt: Point, tolerance = 6): boolean {
    const d = distToSegment(pt, { x: this.x1, y: this.y1 }, { x: this.x2, y: this.y2 });
    return d <= tolerance + this.lineWidth;
  }

  getBounds(): Bounds {
    return {
      minX: Math.min(this.x1, this.x2),
      minY: Math.min(this.y1, this.y2),
      maxX: Math.max(this.x1, this.x2),
      maxY: Math.max(this.y1, this.y2),
    };
  }

  getOrigin(): Point { return { x: this.x1, y: this.y1 }; }

  translate(dx: number, dy: number): ArrowShape {
    return new ArrowShape({ id: this.id, x1: this.x1 + dx, y1: this.y1 + dy, x2: this.x2 + dx, y2: this.y2 + dy, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, groupId: this.groupId });
  }
}

export class BubbleShape extends Shape {
  readonly type = "bubble" as const;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  labelFontSize?: number;

  constructor(data: { id: string; x: number; y: number; width: number; height: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x = data.x;
    this.y = data.y;
    this.width = data.width;
    this.height = data.height;
    this.label = data.label;
    this.labelFontSize = data.labelFontSize;
  }

  clone(newId?: string): BubbleShape {
    return new BubbleShape({
      id: newId ?? this.id,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      stroke: this.stroke,
      fill: this.fill,
      lineWidth: this.lineWidth,
      label: this.label,
      labelFontSize: this.labelFontSize,
      groupId: this.groupId,
    });
  }

  hitTest(pt: Point, tolerance = 6): boolean {
    return (
      pt.x >= this.x - tolerance &&
      pt.x <= this.x + this.width + tolerance &&
      pt.y >= this.y - tolerance &&
      pt.y <= this.y + this.height + 16 + tolerance
    );
  }

  getBounds(): Bounds {
    return { minX: this.x, minY: this.y, maxX: this.x + this.width, maxY: this.y + this.height + 16 };
  }

  getOrigin(): Point { return { x: this.x, y: this.y }; }

  translate(dx: number, dy: number): BubbleShape {
    return new BubbleShape({
      id: this.id,
      x: this.x + dx,
      y: this.y + dy,
      width: this.width,
      height: this.height,
      stroke: this.stroke,
      fill: this.fill,
      lineWidth: this.lineWidth,
      label: this.label,
      labelFontSize: this.labelFontSize,
      groupId: this.groupId,
    });
  }
}

export class TextShape extends Shape {
  readonly type = "text" as const;
  x: number;
  y: number;
  text: string;
  fontSize: number;

  constructor(data: { id: string; x: number; y: number; text: string; fontSize: number; stroke: string; fill: string; lineWidth: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x = data.x;
    this.y = data.y;
    this.text = data.text;
    this.fontSize = data.fontSize;
  }

  clone(newId?: string): TextShape {
    return new TextShape({ id: newId ?? this.id, x: this.x, y: this.y, text: this.text, fontSize: this.fontSize, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, groupId: this.groupId });
  }

  hitTest(pt: Point, tolerance = 6): boolean {
    return (
      pt.x >= this.x - tolerance &&
      pt.x <= this.x + this.text.length * this.fontSize * 0.6 + tolerance &&
      pt.y >= this.y - this.fontSize - tolerance &&
      pt.y <= this.y + tolerance
    );
  }

  getBounds(): Bounds {
    const width = this.text.length * this.fontSize * 0.6;
    return { minX: this.x, minY: this.y - this.fontSize, maxX: this.x + width, maxY: this.y };
  }

  getOrigin(): Point { return { x: this.x, y: this.y }; }

  translate(dx: number, dy: number): TextShape {
    return new TextShape({ id: this.id, x: this.x + dx, y: this.y + dy, text: this.text, fontSize: this.fontSize, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, groupId: this.groupId });
  }
}

export class TableShape extends Shape {
  readonly type = "table" as const;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  /** Row-major 2D array of cell text. cells[row][col] */
  cells: string[][];
  fontSize: number;

  constructor(data: { id: string; x: number; y: number; width: number; height: number; rows: number; cols: number; cells: string[][]; fontSize: number; stroke: string; fill: string; lineWidth: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x = data.x;
    this.y = data.y;
    this.width = data.width;
    this.height = data.height;
    this.rows = data.rows;
    this.cols = data.cols;
    this.cells = data.cells;
    this.fontSize = data.fontSize;
  }

  clone(newId?: string): TableShape {
    return new TableShape({
      id: newId ?? this.id,
      x: this.x, y: this.y, width: this.width, height: this.height,
      rows: this.rows, cols: this.cols,
      cells: this.cells.map(row => [...row]),
      fontSize: this.fontSize,
      stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, groupId: this.groupId,
    });
  }

  hitTest(pt: Point, tolerance = 6): boolean {
    return (
      pt.x >= this.x - tolerance &&
      pt.x <= this.x + this.width + tolerance &&
      pt.y >= this.y - tolerance &&
      pt.y <= this.y + this.height + tolerance
    );
  }

  getBounds(): Bounds {
    return { minX: this.x, minY: this.y, maxX: this.x + this.width, maxY: this.y + this.height };
  }

  getOrigin(): Point { return { x: this.x, y: this.y }; }

  translate(dx: number, dy: number): TableShape {
    return new TableShape({
      id: this.id,
      x: this.x + dx, y: this.y + dy, width: this.width, height: this.height,
      rows: this.rows, cols: this.cols,
      cells: this.cells.map(row => [...row]),
      fontSize: this.fontSize,
      stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, groupId: this.groupId,
    });
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

/** Plain-object shape representation (for JSON deserialization) */
export type ShapeJSON =
  | { type: "rect"; id: string; x: number; y: number; width: number; height: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; groupId?: string }
  | { type: "ellipse"; id: string; cx: number; cy: number; rx: number; ry: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; groupId?: string }
  | { type: "arrow"; id: string; x1: number; y1: number; x2: number; y2: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; groupId?: string }
  | { type: "bubble"; id: string; x: number; y: number; width: number; height: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; groupId?: string }
  | { type: "text"; id: string; x: number; y: number; text: string; fontSize: number; stroke: string; fill: string; lineWidth: number; groupId?: string }
  | { type: "table"; id: string; x: number; y: number; width: number; height: number; rows: number; cols: number; cells: string[][]; fontSize: number; stroke: string; fill: string; lineWidth: number; groupId?: string };

/** Reconstruct a Shape class instance from a plain JSON object */
export function reviveShape(data: ShapeJSON): Shape {
  switch (data.type) {
    case "rect": return new RectShape(data);
    case "ellipse": return new EllipseShape(data);
    case "arrow": return new ArrowShape(data);
    case "bubble": return new BubbleShape(data);
    case "text": return new TextShape(data);
    case "table": return new TableShape(data);
  }
}

/** Reconstruct Shape instances from an array of plain JSON objects */
export function reviveShapes(data: ShapeJSON[]): Shape[] {
  return data.map(reviveShape);
}

/** Messages from WebView to Extension */
export type WebviewToExtMessage =
  | { command: "save"; svgContent: string }
  | { command: "ready" }
  | { command: "listTemplates" }
  | { command: "saveTemplate"; name: string; shapes: ShapeJSON[] }
  | { command: "saveTemplateSvg"; name: string; svgContent: string }
  | { command: "applyTemplate"; templateId: string }
  | { command: "deleteTemplate"; templateId: string };

/** Messages from Extension to WebView */
export type ExtToWebviewMessage =
  | { command: "load"; shapes: ShapeJSON[] }
  | { command: "init"; svgContent?: string }
  | { command: "templatesList"; templates: DiagramTemplateSummary[] }
  | { command: "templatePayload"; templateId: string; name: string; shapes: ShapeJSON[] }
  | { command: "templateSaved"; template: DiagramTemplateSummary }
  | { command: "templateDeleted"; templateId: string }
  | { command: "error"; message: string };

export type ToolType = "rect" | "ellipse" | "arrow" | "bubble" | "text" | "table" | "select";

/** Diagram data for serialization */
export interface DiagramData {
  version: 1;
  shapes: Shape[];
}

/** Stored diagram template */
export interface DiagramTemplate {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnailSvg: string;
  diagram: DiagramData;
}

/** Lightweight template info for list rendering */
export interface DiagramTemplateSummary {
  id: string;
  name: string;
  updatedAt: number;
  shapeCount: number;
  thumbnailSvg: string;
}
