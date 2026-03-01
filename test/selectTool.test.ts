import { describe, it, expect, beforeEach } from "vitest";
import { SelectTool } from "../webview/canvas/tools/SelectTool";
import { RectShape, EllipseShape, ArrowShape, BubbleShape, type Shape } from "../src/types";
import type { DrawStyle } from "../webview/shared";

const style: DrawStyle = { stroke: "#000", fill: "#fff", lineWidth: 2 };

function makeRect(id: string, x: number, y: number, w: number, h: number): RectShape {
  return new RectShape({ id, x, y, width: w, height: h, stroke: "#000", fill: "#fff", lineWidth: 2 });
}

// --- FR-2 Select: 選択・移動ツール ---

describe("SelectTool", () => {
  let shapes: Shape[];
  let selectedIds: Set<string>;
  let undoPushCount: number;
  let tool: SelectTool;

  beforeEach(() => {
    shapes = [
      makeRect("r1", 100, 100, 200, 100),
      makeRect("r2", 400, 100, 100, 100),
    ];
    selectedIds = new Set();
    undoPushCount = 0;
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });
  });

  it("図形上のクリックで選択される", () => {
    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseUp({ x: 150, y: 150 });

    expect(selectedIds.has("r1")).toBe(true);
    expect(selectedIds.size).toBe(1);
    expect(tool.selectedShapeId).toBe("r1");
  });

  it("空白エリアのクリックで選択解除される", () => {
    // まず選択
    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseUp({ x: 150, y: 150 });
    expect(selectedIds.has("r1")).toBe(true);

    // 空白クリック
    tool.onMouseDown({ x: 50, y: 50 }, style);
    tool.onMouseUp({ x: 50, y: 50 });
    expect(selectedIds.size).toBe(0);
    expect(tool.selectedShapeId).toBeUndefined();
  });

  it("最前面 (後に追加された) の図形が優先して選択される", () => {
    // r1 と重なる位置に r3 を追加
    shapes.push(makeRect("r3", 150, 120, 100, 60));
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    tool.onMouseDown({ x: 180, y: 140 }, style);
    tool.onMouseUp({ x: 180, y: 140 });
    expect(selectedIds.has("r3")).toBe(true);
    expect(selectedIds.size).toBe(1);
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
    const ellipse = new EllipseShape({
      id: "e1", cx: 300, cy: 300, rx: 50, ry: 30,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    });
    shapes.push(ellipse);
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    tool.onMouseDown({ x: 300, y: 300 }, style);
    tool.onMouseMove({ x: 350, y: 320 });
    tool.onMouseUp({ x: 350, y: 320 });

    expect(ellipse.cx).toBe(350);
    expect(ellipse.cy).toBe(320);
    expect(ellipse.rx).toBe(50); // サイズは不変
    expect(ellipse.ry).toBe(30);
  });

  it("ドラッグで arrow を移動できる (両端が同量移動)", () => {
    const arrow = new ArrowShape({
      id: "a1", x1: 100, y1: 100, x2: 200, y2: 200,
      stroke: "#000", fill: "none", lineWidth: 2,
    });
    shapes.push(arrow);
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

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
    expect(selectedIds.size).toBe(0);
  });
});

// --- ハンドルドラッグによるリサイズ ---

describe("SelectTool – handle resize", () => {
  let shapes: Shape[];
  let selectedIds: Set<string>;
  let undoPushCount: number;
  let tool: SelectTool;

  beforeEach(() => {
    undoPushCount = 0;
    selectedIds = new Set();
  });

  it("rect の BR ハンドルドラッグでサイズ変更できる", () => {
    const rect = makeRect("r1", 100, 100, 200, 100);
    shapes = [rect];
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    // まず選択する
    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseUp({ x: 150, y: 150 });

    // BR ハンドル位置 = (100+200+4, 100+100+4) = (304, 204)
    tool.onMouseDown({ x: 304, y: 204 }, style);
    tool.onMouseMove({ x: 354, y: 254 });
    tool.onMouseUp({ x: 354, y: 254 });

    expect(rect.width).toBe(254);  // 354 - 100
    expect(rect.height).toBe(154); // 254 - 100
    expect(rect.x).toBe(100);     // 左上は不変
    expect(rect.y).toBe(100);
    expect(undoPushCount).toBe(1); // undo は1回だけ push
  });

  it("rect の TL ハンドルドラッグでサイズと位置が変更される", () => {
    const rect = makeRect("r1", 100, 100, 200, 100);
    shapes = [rect];
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseUp({ x: 150, y: 150 });

    // TL ハンドル位置 = (100-4, 100-4) = (96, 96)
    tool.onMouseDown({ x: 96, y: 96 }, style);
    tool.onMouseMove({ x: 76, y: 76 });
    tool.onMouseUp({ x: 76, y: 76 });

    expect(rect.x).toBe(76);
    expect(rect.y).toBe(76);
    expect(rect.width).toBe(224);  // +20 wider to the left
    expect(rect.height).toBe(124); // +20 taller to the top
  });

  it("ellipse の BR ハンドルドラッグでサイズ変更できる", () => {
    const ellipse = new EllipseShape({
      id: "e1", cx: 200, cy: 200, rx: 60, ry: 40,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    });
    shapes = [ellipse];
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    tool.onMouseDown({ x: 200, y: 200 }, style);
    tool.onMouseUp({ x: 200, y: 200 });

    // BR handle = (cx+rx+4, cy+ry+4) = (264, 244)
    tool.onMouseDown({ x: 264, y: 244 }, style);
    tool.onMouseMove({ x: 284, y: 264 });
    tool.onMouseUp({ x: 284, y: 264 });

    // Bounding box was (140, 160, 120, 80) → BR moved by +20 → (140, 160, 140, 100)
    expect(ellipse.rx).toBe(72);  // 144/2
    expect(ellipse.ry).toBe(52);  // 104/2
  });

  it("arrow の start ハンドルドラッグで始点を変更できる", () => {
    const arrow = new ArrowShape({
      id: "a1", x1: 100, y1: 100, x2: 300, y2: 200,
      stroke: "#000", fill: "none", lineWidth: 2,
    });
    shapes = [arrow];
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    // 矢印の中間点付近をクリックして選択
    tool.onMouseDown({ x: 200, y: 150 }, style);
    tool.onMouseUp({ x: 200, y: 150 });

    // start ハンドル = (x1, y1) = (100, 100)
    tool.onMouseDown({ x: 100, y: 100 }, style);
    tool.onMouseMove({ x: 50, y: 80 });
    tool.onMouseUp({ x: 50, y: 80 });

    expect(arrow.x1).toBe(50);
    expect(arrow.y1).toBe(80);
    expect(arrow.x2).toBe(300);  // end は不変
    expect(arrow.y2).toBe(200);
  });

  it("arrow の end ハンドルドラッグで終点を変更できる", () => {
    const arrow = new ArrowShape({
      id: "a1", x1: 100, y1: 100, x2: 300, y2: 200,
      stroke: "#000", fill: "none", lineWidth: 2,
    });
    shapes = [arrow];
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    tool.onMouseDown({ x: 200, y: 150 }, style);
    tool.onMouseUp({ x: 200, y: 150 });

    // end ハンドル = (x2, y2) = (300, 200)
    tool.onMouseDown({ x: 300, y: 200 }, style);
    tool.onMouseMove({ x: 350, y: 250 });
    tool.onMouseUp({ x: 350, y: 250 });

    expect(arrow.x1).toBe(100);  // start は不変
    expect(arrow.y1).toBe(100);
    expect(arrow.x2).toBe(350);
    expect(arrow.y2).toBe(250);
  });

  it("bubble のハンドルドラッグで消失せずサイズ変更できる", () => {
    const bubble = new BubbleShape({
      id: "b1", x: 120, y: 120, width: 120, height: 80,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    });
    shapes = [bubble];
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    // select bubble
    tool.onMouseDown({ x: 160, y: 150 }, style);
    tool.onMouseUp({ x: 160, y: 150 });

    // BR handle ~= (x+width+4, y+height+16+4)
    tool.onMouseDown({ x: 244, y: 220 }, style);
    tool.onMouseMove({ x: 274, y: 250 });
    tool.onMouseUp({ x: 274, y: 250 });

    expect(Number.isFinite(bubble.x)).toBe(true);
    expect(Number.isFinite(bubble.y)).toBe(true);
    expect(Number.isFinite(bubble.width)).toBe(true);
    expect(Number.isFinite(bubble.height)).toBe(true);
    expect(bubble.width).toBeGreaterThan(0);
    expect(bubble.height).toBeGreaterThan(0);
  });

  it("ドラッグ中に onUndoPush が1回だけ呼ばれる", () => {
    const rect = makeRect("r1", 100, 100, 200, 100);
    shapes = [rect];
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseMove({ x: 160, y: 160 });
    tool.onMouseMove({ x: 170, y: 170 });
    tool.onMouseMove({ x: 180, y: 180 });
    tool.onMouseUp({ x: 180, y: 180 });

    expect(undoPushCount).toBe(1);
  });

  it("getCursorAt がハンドル上で正しいカーソルを返す", () => {
    const rect = makeRect("r1", 100, 100, 200, 100);
    shapes = [rect];
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });

    // 選択
    tool.onMouseDown({ x: 150, y: 150 }, style);
    tool.onMouseUp({ x: 150, y: 150 });

    // BR handle
    expect(tool.getCursorAt({ x: 304, y: 204 })).toBe("nwse-resize");
    // TL handle
    expect(tool.getCursorAt({ x: 96, y: 96 })).toBe("nwse-resize");
    // TR handle
    expect(tool.getCursorAt({ x: 304, y: 96 })).toBe("nesw-resize");
    // 図形の内部（ハンドル外）
    expect(tool.getCursorAt({ x: 200, y: 150 })).toBeUndefined();
  });
});
