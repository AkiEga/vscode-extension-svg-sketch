/** Supported shape types */
export type ShapeType = "rect" | "ellipse" | "arrow" | "text" | "table" | "image";
export type LabelHorizontalAlign = "left" | "center" | "right";
export type LabelVerticalAlign = "top" | "middle" | "bottom";

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
  cornerRadius?: number;
  label?: string;
  labelFontSize?: number;
  labelFontFamily?: string;
  labelFontColor?: string;
  labelAlignH?: LabelHorizontalAlign;
  labelAlignV?: LabelVerticalAlign;

  constructor(data: { id: string; x: number; y: number; width: number; height: number; cornerRadius?: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; labelFontFamily?: string; labelFontColor?: string; labelAlignH?: LabelHorizontalAlign; labelAlignV?: LabelVerticalAlign; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x = data.x;
    this.y = data.y;
    this.width = data.width;
    this.height = data.height;
    this.cornerRadius = data.cornerRadius;
    this.label = data.label;
    this.labelFontSize = data.labelFontSize;
    this.labelFontFamily = data.labelFontFamily;
    this.labelFontColor = data.labelFontColor;
    this.labelAlignH = data.labelAlignH;
    this.labelAlignV = data.labelAlignV;
  }

  clone(newId?: string): RectShape {
    return new RectShape({ id: newId ?? this.id, x: this.x, y: this.y, width: this.width, height: this.height, cornerRadius: this.cornerRadius, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, labelFontFamily: this.labelFontFamily, labelFontColor: this.labelFontColor, labelAlignH: this.labelAlignH, labelAlignV: this.labelAlignV, groupId: this.groupId });
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
    return new RectShape({ id: this.id, x: this.x + dx, y: this.y + dy, width: this.width, height: this.height, cornerRadius: this.cornerRadius, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, labelFontFamily: this.labelFontFamily, labelFontColor: this.labelFontColor, labelAlignH: this.labelAlignH, labelAlignV: this.labelAlignV, groupId: this.groupId });
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
  labelFontFamily?: string;
  labelFontColor?: string;
  labelAlignH?: LabelHorizontalAlign;
  labelAlignV?: LabelVerticalAlign;

  constructor(data: { id: string; cx: number; cy: number; rx: number; ry: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; labelFontFamily?: string; labelFontColor?: string; labelAlignH?: LabelHorizontalAlign; labelAlignV?: LabelVerticalAlign; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.cx = data.cx;
    this.cy = data.cy;
    this.rx = data.rx;
    this.ry = data.ry;
    this.label = data.label;
    this.labelFontSize = data.labelFontSize;
    this.labelFontFamily = data.labelFontFamily;
    this.labelFontColor = data.labelFontColor;
    this.labelAlignH = data.labelAlignH;
    this.labelAlignV = data.labelAlignV;
  }

  clone(newId?: string): EllipseShape {
    return new EllipseShape({ id: newId ?? this.id, cx: this.cx, cy: this.cy, rx: this.rx, ry: this.ry, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, labelFontFamily: this.labelFontFamily, labelFontColor: this.labelFontColor, labelAlignH: this.labelAlignH, labelAlignV: this.labelAlignV, groupId: this.groupId });
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
    return new EllipseShape({ id: this.id, cx: this.cx + dx, cy: this.cy + dy, rx: this.rx, ry: this.ry, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, labelFontFamily: this.labelFontFamily, labelFontColor: this.labelFontColor, labelAlignH: this.labelAlignH, labelAlignV: this.labelAlignV, groupId: this.groupId });
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
  labelFontFamily?: string;
  labelFontColor?: string;
  labelAlignH?: LabelHorizontalAlign;
  labelAlignV?: LabelVerticalAlign;

  constructor(data: { id: string; x1: number; y1: number; x2: number; y2: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; labelFontFamily?: string; labelFontColor?: string; labelAlignH?: LabelHorizontalAlign; labelAlignV?: LabelVerticalAlign; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x1 = data.x1;
    this.y1 = data.y1;
    this.x2 = data.x2;
    this.y2 = data.y2;
    this.label = data.label;
    this.labelFontSize = data.labelFontSize;
    this.labelFontFamily = data.labelFontFamily;
    this.labelFontColor = data.labelFontColor;
    this.labelAlignH = data.labelAlignH;
    this.labelAlignV = data.labelAlignV;
  }

  clone(newId?: string): ArrowShape {
    return new ArrowShape({ id: newId ?? this.id, x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, labelFontFamily: this.labelFontFamily, labelFontColor: this.labelFontColor, labelAlignH: this.labelAlignH, labelAlignV: this.labelAlignV, groupId: this.groupId });
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
    return new ArrowShape({ id: this.id, x1: this.x1 + dx, y1: this.y1 + dy, x2: this.x2 + dx, y2: this.y2 + dy, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, label: this.label, labelFontSize: this.labelFontSize, labelFontFamily: this.labelFontFamily, labelFontColor: this.labelFontColor, labelAlignH: this.labelAlignH, labelAlignV: this.labelAlignV, groupId: this.groupId });
  }
}

export class TextShape extends Shape {
  readonly type = "text" as const;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontColor?: string;

  constructor(data: { id: string; x: number; y: number; text: string; fontSize: number; fontFamily?: string; fontColor?: string; stroke: string; fill: string; lineWidth: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x = data.x;
    this.y = data.y;
    this.text = data.text;
    this.fontSize = data.fontSize;
    this.fontFamily = data.fontFamily;
    this.fontColor = data.fontColor;
  }

  clone(newId?: string): TextShape {
    return new TextShape({ id: newId ?? this.id, x: this.x, y: this.y, text: this.text, fontSize: this.fontSize, fontFamily: this.fontFamily, fontColor: this.fontColor, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, groupId: this.groupId });
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
    return new TextShape({ id: this.id, x: this.x + dx, y: this.y + dy, text: this.text, fontSize: this.fontSize, fontFamily: this.fontFamily, fontColor: this.fontColor, stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, groupId: this.groupId });
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
  fontFamily?: string;
  fontColor?: string;

  constructor(data: { id: string; x: number; y: number; width: number; height: number; rows: number; cols: number; cells: string[][]; fontSize: number; fontFamily?: string; fontColor?: string; stroke: string; fill: string; lineWidth: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x = data.x;
    this.y = data.y;
    this.width = data.width;
    this.height = data.height;
    this.rows = data.rows;
    this.cols = data.cols;
    this.cells = data.cells;
    this.fontSize = data.fontSize;
    this.fontFamily = data.fontFamily;
    this.fontColor = data.fontColor;
  }

  clone(newId?: string): TableShape {
    return new TableShape({
      id: newId ?? this.id,
      x: this.x, y: this.y, width: this.width, height: this.height,
      rows: this.rows, cols: this.cols,
      cells: this.cells.map(row => [...row]),
      fontSize: this.fontSize, fontFamily: this.fontFamily, fontColor: this.fontColor,
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
      fontSize: this.fontSize, fontFamily: this.fontFamily, fontColor: this.fontColor,
      stroke: this.stroke, fill: this.fill, lineWidth: this.lineWidth, groupId: this.groupId,
    });
  }
}

export class ImageShape extends Shape {
  readonly type = "image" as const;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;

  constructor(data: { id: string; x: number; y: number; width: number; height: number; dataUrl: string; stroke: string; fill: string; lineWidth: number; groupId?: string }) {
    super(data.id, data.stroke, data.fill, data.lineWidth, data.groupId);
    this.x = data.x;
    this.y = data.y;
    this.width = data.width;
    this.height = data.height;
    this.dataUrl = data.dataUrl;
  }

  clone(newId?: string): ImageShape {
    return new ImageShape({
      id: newId ?? this.id,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      dataUrl: this.dataUrl,
      stroke: this.stroke,
      fill: this.fill,
      lineWidth: this.lineWidth,
      groupId: this.groupId,
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

  translate(dx: number, dy: number): ImageShape {
    return new ImageShape({
      id: this.id,
      x: this.x + dx,
      y: this.y + dy,
      width: this.width,
      height: this.height,
      dataUrl: this.dataUrl,
      stroke: this.stroke,
      fill: this.fill,
      lineWidth: this.lineWidth,
      groupId: this.groupId,
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

/** Concrete shape union — switch(shape.type) で型絞り込み可能 */
export type ConcreteShape = RectShape | EllipseShape | ArrowShape | TextShape | TableShape | ImageShape;

/** Plain-object shape representation (for JSON deserialization) */
export type ShapeJSON =
  | { type: "rect"; id: string; x: number; y: number; width: number; height: number; cornerRadius?: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; labelFontFamily?: string; labelFontColor?: string; labelAlignH?: LabelHorizontalAlign; labelAlignV?: LabelVerticalAlign; groupId?: string }
  | { type: "ellipse"; id: string; cx: number; cy: number; rx: number; ry: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; labelFontFamily?: string; labelFontColor?: string; labelAlignH?: LabelHorizontalAlign; labelAlignV?: LabelVerticalAlign; groupId?: string }
  | { type: "arrow"; id: string; x1: number; y1: number; x2: number; y2: number; stroke: string; fill: string; lineWidth: number; label?: string; labelFontSize?: number; labelFontFamily?: string; labelFontColor?: string; labelAlignH?: LabelHorizontalAlign; labelAlignV?: LabelVerticalAlign; groupId?: string }
  | { type: "text"; id: string; x: number; y: number; text: string; fontSize: number; fontFamily?: string; fontColor?: string; stroke: string; fill: string; lineWidth: number; groupId?: string }
  | { type: "table"; id: string; x: number; y: number; width: number; height: number; rows: number; cols: number; cells: string[][]; fontSize: number; fontFamily?: string; fontColor?: string; stroke: string; fill: string; lineWidth: number; groupId?: string }
  | { type: "image"; id: string; x: number; y: number; width: number; height: number; dataUrl: string; stroke: string; fill: string; lineWidth: number; groupId?: string };

/** Reconstruct a Shape class instance from a plain JSON object */
export function reviveShape(data: ShapeJSON): Shape {
  switch (data.type) {
    case "rect": return new RectShape(data);
    case "ellipse": return new EllipseShape(data);
    case "arrow": return new ArrowShape(data);
    case "text": return new TextShape(data);
    case "table": return new TableShape(data);
    case "image": return new ImageShape(data);
  }
}

export interface EditorSettings {
  defaultStyle?: {
    stroke: string;
    fill: string;
    lineWidth: number;
  };
  screenshotPasteEnabled?: boolean;
  screenshotPasteMaxWidth?: number;
  /** カスタム SVG から読み取った図形デフォルト設定 */
  shapeDefaults?: {
    stroke: string;
    fill: string;
    lineWidth: number;
    fontSize: number;
    fontFamily: string;
    fontColor: string;
    tableHeaderBg: string;
    paletteColors: readonly string[];
  };
}

/** Reconstruct Shape instances from an array of plain JSON objects */
export function reviveShapes(data: ShapeJSON[]): Shape[] {
  return data.map(reviveShape);
}

/** Messages from WebView to Extension */
export type WebviewToExtMessage =
  | { command: "save"; svgContent: string }
  | { command: "saveAndClose"; svgContent: string }
  | { command: "close" }
  | { command: "closeWithoutSave" }
  | { command: "ready" }
  | { command: "listTemplates" }
  | { command: "saveTemplate"; name: string; shapes: ShapeJSON[] }
  | { command: "saveTemplateSvg"; name: string; svgContent: string }
  | { command: "applyTemplate"; templateId: string }
  | { command: "deleteTemplate"; templateId: string };

/** Messages from Extension to WebView */
export type ExtToWebviewMessage =
  | { command: "load"; shapes: ShapeJSON[] }
  | { command: "init"; svgContent?: string; settings?: EditorSettings }
  | { command: "templatesList"; templates: DiagramTemplateSummary[] }
  | { command: "templatePayload"; templateId: string; name: string; shapes: ShapeJSON[] }
  | { command: "templateSaved"; template: DiagramTemplateSummary }
  | { command: "templateDeleted"; templateId: string }
  | { command: "error"; message: string };

export type ToolType = "rect" | "ellipse" | "arrow" | "text" | "table" | "select";

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
