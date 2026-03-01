/** Supported shape types */
export type ShapeType = "rect" | "ellipse" | "arrow" | "text";

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

export type Shape = RectShape | EllipseShape | ArrowShape | TextShape;

/** Messages from WebView to Extension */
export type WebviewToExtMessage =
  | { command: "save"; svgContent: string }
  | { command: "ready" };

/** Messages from Extension to WebView */
export type ExtToWebviewMessage =
  | { command: "load"; shapes: Shape[] }
  | { command: "init"; svgContent?: string };

export type ToolType = "rect" | "ellipse" | "arrow" | "text" | "select";

/** Diagram data for serialization */
export interface DiagramData {
  version: 1;
  shapes: Shape[];
}
