import { describe, it, expect, beforeEach } from "vitest";
import { SelectTool } from "../webview/canvas/tools/SelectTool";
import type { RectShape, EllipseShape, ArrowShape, Shape } from "../src/types";
import type { DrawStyle } from "../webview/shared";

const style: DrawStyle = { stroke: "#000", fill: "#fff", lineWidth: 2 };

function makeRect(id: string, x: number, y: number, w: number, h: number): RectShape {
  return { id, type: "rect", x, y, width: w, height: h, stroke: "#000", fill: "#fff", lineWidth: 2 };
}

// --- FR-2 Select: 選択・移動ツール ---

describe("SelectTool", () => {
  let shapes: Shape[];
  let selectedId: string | undefined;
  let tool: SelectTool;

  beforeEach(() => {
    shapes = [
      makeRect("r1", 100, 100, 200, 100),
      makeRect("r2", 400, 100, 100, 100),
    ];
    selectedId = undefined;
    tool = new SelectTool(shapes, (id) => { selectedId = id; });
  });

  it("図形上のクリックで選択される", () => {
    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseUp({ x: 150, y: 150 });

    expect(selectedId).toBe("r1");
    expect(tool.selectedShapeId).toBe("r1");
  });

  it("空白エリアのクリックで選択解除される", () => {
    // まず選択
    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseUp({ x: 150, y: 150 });
    expect(selectedId).toBe("r1");

    // 空白クリック
    tool.onMouseDown({ x: 50, y: 50 }, style);
    tool.onMouseUp({ x: 50, y: 50 });
    expect(selectedId).toBeUndefined();
    expect(tool.selectedShapeId).toBeUndefined();
  });

  it("最前面 (後に追加された) の図形が優先して選択される", () => {
    // r1 と重なる位置に r3 を追加
    shapes.push(makeRect("r3", 150, 120, 100, 60));
    tool = new SelectTool(shapes, (id) => { selectedId = id; });

    tool.onMouseDown({ x: 180, y: 140 }, style);
    tool.onMouseUp({ x: 180, y: 140 });
    expect(selectedId).toBe("r3");
  });

  it("ドラッグで rect を移動できる", () => {
    tool.onMouseDown({ x: 150, y: 150 }, style);
    // ドラッグ: 150,150 → 200,200 (Δx=50, Δy=50)
    tool.onMouseMove({ x: 200, y: 200 });
    tool.onMouseUp({ x: 200, y: 200 });

    const r1 = shapes.find((s) => s.id === "r1") as RectShape;
    expect(r1.x).toBe(150);   // 元の x=100 + Δ50
    expect(r1.y).toBe(150);   // 元の y=100 + Δ50
    expect(r1.width).toBe(200);   // サイズは不変
    expect(r1.height).toBe(100);
  });

  it("ドラッグで ellipse を移動できる", () => {
    const ellipse: EllipseShape = {
      id: "e1", type: "ellipse", cx: 300, cy: 300, rx: 50, ry: 30,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    };
    shapes.push(ellipse);
    tool = new SelectTool(shapes, (id) => { selectedId = id; });

    tool.onMouseDown({ x: 300, y: 300 }, style);
    tool.onMouseMove({ x: 350, y: 320 });
    tool.onMouseUp({ x: 350, y: 320 });

    expect(ellipse.cx).toBe(350);
    expect(ellipse.cy).toBe(320);
    expect(ellipse.rx).toBe(50); // サイズは不変
    expect(ellipse.ry).toBe(30);
  });

  it("ドラッグで arrow を移動できる (両端が同量移動)", () => {
    const arrow: ArrowShape = {
      id: "a1", type: "arrow", x1: 100, y1: 100, x2: 200, y2: 200,
      stroke: "#000", fill: "none", lineWidth: 2,
    };
    shapes.push(arrow);
    tool = new SelectTool(shapes, (id) => { selectedId = id; });

    // 矢印の中間点付近をクリック
    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseMove({ x: 170, y: 170 });
    tool.onMouseUp({ x: 170, y: 170 });

    // 両端がΔ20ずつ移動
    expect(arrow.x1).toBe(120);
    expect(arrow.y1).toBe(120);
    expect(arrow.x2).toBe(220);
    expect(arrow.y2).toBe(220);
  });

  it("mouseUp は常に undefined を返す (新規図形を作成しない)", () => {
    tool.onMouseDown({ x: 150, y: 150 }, style);
    const result = tool.onMouseUp({ x: 150, y: 150 });
    expect(result).toBeUndefined();
  });

  it("getPreview は常に undefined を返す", () => {
    tool.onMouseDown({ x: 150, y: 150 }, style);
    expect(tool.getPreview()).toBeUndefined();
  });

  it("選択なし状態で mouseMove しても例外が発生しない", () => {
    tool.onMouseMove({ x: 200, y: 200 });
    expect(selectedId).toBeUndefined();
  });
});
