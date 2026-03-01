import { describe, it, expect, beforeEach } from "vitest";
import { RectTool } from "../webview/canvas/tools/RectTool";
import { EllipseTool } from "../webview/canvas/tools/EllipseTool";
import { ArrowTool } from "../webview/canvas/tools/ArrowTool";
import type { DrawStyle } from "../webview/shared";
import { RectShape, EllipseShape, ArrowShape } from "../src/types";

const defaultStyle: DrawStyle = { stroke: "#000", fill: "#fff", lineWidth: 2 };

// --- FR-2: 図形描画ツール ---

describe("RectTool", () => {
  let tool: RectTool;

  beforeEach(() => {
    tool = new RectTool();
  });

  it("mouseDown 前は preview が undefined", () => {
    expect(tool.getPreview()).toBeUndefined();
  });

  it("ドラッグで矩形を作成する", () => {
    tool.onMouseDown({ x: 10, y: 20 }, defaultStyle);
    tool.onMouseMove({ x: 110, y: 80 });
    const shape = tool.onMouseUp({ x: 110, y: 80 });

    expect(shape).toBeDefined();
    expect(shape!.type).toBe("rect");
    const rect = shape as RectShape;
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(20);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(60);
  });

  it("ドラッグ中に preview が取得できる", () => {
    tool.onMouseDown({ x: 0, y: 0 }, defaultStyle);
    tool.onMouseMove({ x: 50, y: 50 });
    const preview = tool.getPreview();

    expect(preview).toBeDefined();
    expect(preview!.type).toBe("rect");
    const rect = preview as RectShape;
    expect(rect.width).toBe(50);
    expect(rect.height).toBe(50);
  });

  it("逆方向ドラッグでも正しく正規化される", () => {
    tool.onMouseDown({ x: 100, y: 100 }, defaultStyle);
    tool.onMouseMove({ x: 20, y: 30 });
    const shape = tool.onMouseUp({ x: 20, y: 30 }) as RectShape;

    expect(shape.x).toBe(20);
    expect(shape.y).toBe(30);
    expect(shape.width).toBe(80);
    expect(shape.height).toBe(70);
  });

  it("スタイルが shape に反映される", () => {
    const style: DrawStyle = { stroke: "#f00", fill: "#0f0", lineWidth: 5 };
    tool.onMouseDown({ x: 0, y: 0 }, style);
    tool.onMouseMove({ x: 50, y: 50 });
    const shape = tool.onMouseUp({ x: 50, y: 50 });

    expect(shape!.stroke).toBe("#f00");
    expect(shape!.fill).toBe("#0f0");
    expect(shape!.lineWidth).toBe(5);
  });

  it("mouseDown なしの mouseUp は undefined を返す", () => {
    const shape = tool.onMouseUp({ x: 50, y: 50 });
    expect(shape).toBeUndefined();
  });

  it("mouseUp 後に preview はリセットされる", () => {
    tool.onMouseDown({ x: 0, y: 0 }, defaultStyle);
    tool.onMouseMove({ x: 50, y: 50 });
    tool.onMouseUp({ x: 50, y: 50 });
    expect(tool.getPreview()).toBeUndefined();
  });
});

describe("EllipseTool", () => {
  let tool: EllipseTool;

  beforeEach(() => {
    tool = new EllipseTool();
  });

  it("ドラッグで楕円を作成する", () => {
    tool.onMouseDown({ x: 0, y: 0 }, defaultStyle);
    tool.onMouseMove({ x: 200, y: 100 });
    const shape = tool.onMouseUp({ x: 200, y: 100 });

    expect(shape).toBeDefined();
    expect(shape!.type).toBe("ellipse");
    const ellipse = shape as EllipseShape;
    expect(ellipse.cx).toBe(100);  // (0+200)/2
    expect(ellipse.cy).toBe(50);   // (0+100)/2
    expect(ellipse.rx).toBe(100);  // |200-0|/2
    expect(ellipse.ry).toBe(50);   // |100-0|/2
  });

  it("ドラッグ中に preview が取得できる", () => {
    tool.onMouseDown({ x: 50, y: 50 }, defaultStyle);
    tool.onMouseMove({ x: 150, y: 100 });
    const preview = tool.getPreview();

    expect(preview).toBeDefined();
    expect(preview!.type).toBe("ellipse");
    const ellipse = preview as EllipseShape;
    expect(ellipse.cx).toBe(100);
    expect(ellipse.cy).toBe(75);
    expect(ellipse.rx).toBe(50);
    expect(ellipse.ry).toBe(25);
  });

  it("逆方向ドラッグでも正しく計算される", () => {
    tool.onMouseDown({ x: 200, y: 100 }, defaultStyle);
    tool.onMouseMove({ x: 0, y: 0 });
    const shape = tool.onMouseUp({ x: 0, y: 0 }) as EllipseShape;

    expect(shape.cx).toBe(100);
    expect(shape.cy).toBe(50);
    expect(shape.rx).toBe(100);
    expect(shape.ry).toBe(50);
  });

  it("mouseDown なしの mouseUp は undefined を返す", () => {
    expect(tool.onMouseUp({ x: 50, y: 50 })).toBeUndefined();
  });
});

describe("ArrowTool", () => {
  let tool: ArrowTool;

  beforeEach(() => {
    tool = new ArrowTool();
  });

  it("ドラッグで矢印を作成する", () => {
    tool.onMouseDown({ x: 10, y: 20 }, defaultStyle);
    tool.onMouseMove({ x: 200, y: 150 });
    const shape = tool.onMouseUp({ x: 200, y: 150 });

    expect(shape).toBeDefined();
    expect(shape!.type).toBe("arrow");
    const arrow = shape as ArrowShape;
    expect(arrow.x1).toBe(10);
    expect(arrow.y1).toBe(20);
    expect(arrow.x2).toBe(200);
    expect(arrow.y2).toBe(150);
  });

  it("fill は常に none に設定される", () => {
    const style: DrawStyle = { stroke: "#f00", fill: "#0f0", lineWidth: 3 };
    tool.onMouseDown({ x: 0, y: 0 }, style);
    tool.onMouseMove({ x: 100, y: 100 });
    const shape = tool.onMouseUp({ x: 100, y: 100 });

    expect(shape!.fill).toBe("none");
    expect(shape!.stroke).toBe("#f00");
    expect(shape!.lineWidth).toBe(3);
  });

  it("ドラッグ中に preview が取得できる", () => {
    tool.onMouseDown({ x: 0, y: 0 }, defaultStyle);
    tool.onMouseMove({ x: 80, y: 60 });
    const preview = tool.getPreview();

    expect(preview).toBeDefined();
    expect(preview!.type).toBe("arrow");
    const arrow = preview as ArrowShape;
    expect(arrow.x1).toBe(0);
    expect(arrow.y1).toBe(0);
    expect(arrow.x2).toBe(80);
    expect(arrow.y2).toBe(60);
  });

  it("mouseDown なしの mouseUp は undefined を返す", () => {
    expect(tool.onMouseUp({ x: 50, y: 50 })).toBeUndefined();
  });
});
