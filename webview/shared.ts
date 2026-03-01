import {
  Shape,
  RectShape,
  EllipseShape,
  ArrowShape,
  BubbleShape,
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
  BubbleShape,
  TextShape,
  TableShape,
  ImageShape,
  reviveShape,
  reviveShapes,
};
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
