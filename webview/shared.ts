import {
  Shape,
  RectShape,
  EllipseShape,
  ArrowShape,
  TextShape,
  TableShape,
  ImageShape,
  reviveShape,
  reviveShapes,
} from "../src/types";
import type {
  ShapeType,
  ShapeJSON,
  ToolType,
  Point,
  Bounds,
  DiagramData,
  DiagramTemplateSummary,
  EditorSettings,
  WebviewToExtMessage,
  ExtToWebviewMessage,
} from "../src/types";

// Re-export types for webview modules
export {
  Shape,
  RectShape,
  EllipseShape,
  ArrowShape,
  TextShape,
  TableShape,
  ImageShape,
  reviveShape,
  reviveShapes,
};

// Re-export shape configuration constants
export {
  DEFAULT_STROKE,
  DEFAULT_FILL,
  DEFAULT_LINE_WIDTH,
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_COLOR,
  TABLE_HEADER_BG,
  PALETTE_COLORS,
  shapeDefaults,
  applyCustomDefaults,
  parseShapeDefaultsSvg,
} from "../src/shapeConfig";
export type { ShapeDefaults } from "../src/shapeConfig";
export type {
  ShapeType,
  ShapeJSON,
  ToolType,
  Point,
  Bounds,
  DiagramData,
  DiagramTemplateSummary,
  EditorSettings,
  WebviewToExtMessage,
  ExtToWebviewMessage,
};

export interface DrawStyle {
  stroke: string;
  fill: string;
  lineWidth: number;
  cornerRadius: number;
  fontSize: number;
  fontFamily: string;
  fontColor: string;
  labelAlignH: "left" | "center" | "right";
  labelAlignV: "top" | "middle" | "bottom";
}

/** Modifier key state passed from mouse events */
export interface MouseOptions {
  shiftKey?: boolean;
}

export interface Tool {
  onMouseDown(pt: Point, style: DrawStyle, options?: MouseOptions): void;
  onMouseMove(pt: Point): void;
  onMouseUp(pt: Point): Shape | undefined;
  /** Preview shape while dragging (optional) */
  getPreview(): Shape | undefined;
}

/** Hit-test: is point inside shape? (delegates to shape method) */
export function hitTest(shape: Shape, pt: Point, tolerance = 6): boolean {
  return shape.hitTest(pt, tolerance);
}

let _nextId = 1;
export function nextId(): string {
  return `s${_nextId++}`;
}
