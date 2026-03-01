/** Supported shape types */
export type ShapeType = "rect" | "ellipse" | "arrow" | "text" | "table";

/** Base properties shared by all shapes */
export interface ShapeBase {
  id: string;
  type: ShapeType;
  stroke: string;
  fill: string;
  lineWidth: number;
}

export interface RectShape extends ShapeBase {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EllipseShape extends ShapeBase {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface ArrowShape extends ShapeBase {
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextShape extends ShapeBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export interface TableShape extends ShapeBase {
  type: "table";
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  /** Row-major 2D array of cell text. cells[row][col] */
  cells: string[][];
  fontSize: number;
}

export type Shape = RectShape | EllipseShape | ArrowShape | TextShape | TableShape;

/** Messages from WebView to Extension */
export type WebviewToExtMessage =
  | { command: "save"; svgContent: string }
  | { command: "ready" }
  | { command: "listTemplates" }
  | { command: "saveTemplate"; name: string; shapes: Shape[] }
  | { command: "applyTemplate"; templateId: string }
  | { command: "deleteTemplate"; templateId: string };

/** Messages from Extension to WebView */
export type ExtToWebviewMessage =
  | { command: "load"; shapes: Shape[] }
  | { command: "init"; svgContent?: string }
  | { command: "templatesList"; templates: DiagramTemplateSummary[] }
  | { command: "templatePayload"; templateId: string; name: string; shapes: Shape[] }
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
