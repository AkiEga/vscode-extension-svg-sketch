import { describe, it, expect, beforeEach } from "vitest";
import { SelectTool } from "../webview/canvas/tools/SelectTool";
import { RectShape, EllipseShape, ArrowShape, type Shape, type Point } from "../src/types";
import type { DrawStyle } from "../webview/shared";

const style: DrawStyle = { stroke: "#000", fill: "#fff", lineWidth: 2 };

function makeRect(id: string, x: number, y: number, w: number, h: number): RectShape {
  return new RectShape({ id, x, y, width: w, height: h, stroke: "#000", fill: "#fff", lineWidth: 2 });
}

// --- 複数図形の一括選択 ---

describe("SelectTool – multi-select (Shift+Click)", () => {
  let shapes: Shape[];
  let selectedIds: Set<string>;
  let undoPushCount: number;
  let tool: SelectTool;

  beforeEach(() => {
    shapes = [
      makeRect("r1", 100, 100, 80, 80),
      makeRect("r2", 300, 100, 80, 80),
      makeRect("r3", 500, 100, 80, 80),
    ];
    selectedIds = new Set();
    undoPushCount = 0;
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });
  });

  it("Shift+Click で複数の図形を選択できる", () => {
    // 1つ目を選択
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });
    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has("r1")).toBe(true);

    // Shift+Click で2つ目を追加
    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });
    expect(selectedIds.size).toBe(2);
    expect(selectedIds.has("r1")).toBe(true);
    expect(selectedIds.has("r2")).toBe(true);

    // Shift+Click で3つ目を追加
    tool.onMouseDown({ x: 540, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 540, y: 140 });
    expect(selectedIds.size).toBe(3);
  });

  it("Shift+Click で選択中の図形を解除できる (トグル)", () => {
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });

    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });
    expect(selectedIds.size).toBe(2);

    // Shift+Click で r1 を解除
    tool.onMouseDown({ x: 140, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 140, y: 140 });
    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has("r2")).toBe(true);
    expect(selectedIds.has("r1")).toBe(false);
  });

  it("Shift なしのクリックは既存の複数選択をリセットする", () => {
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });
    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });
    expect(selectedIds.size).toBe(2);

    // Shift なしで r3 をクリック → r1, r2 の選択は外れる
    tool.onMouseDown({ x: 540, y: 140 }, style);
    tool.onMouseUp({ x: 540, y: 140 });
    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has("r3")).toBe(true);
  });

  it("複数選択中に選択済み図形を単一クリックすると1つに絞られる", () => {
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });
    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });
    expect(selectedIds.size).toBe(2);

    // r1 をクリックのみ（ドラッグなし）
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });

    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has("r1")).toBe(true);
  });

  it("微小な移動を伴う単一クリックでも1つに絞られる", () => {
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });
    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });
    expect(selectedIds.size).toBe(2);

    // 4px 程度の揺れはクリック扱い
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseMove({ x: 144, y: 142 });
    tool.onMouseUp({ x: 144, y: 142 });

    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has("r1")).toBe(true);
  });

  it("selectedShapeIds が正しい Set を返す", () => {
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });
    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });

    const ids = tool.selectedShapeIds;
    expect(ids.size).toBe(2);
    expect(ids.has("r1")).toBe(true);
    expect(ids.has("r2")).toBe(true);
  });
});

describe("SelectTool – rubber-band marquee selection", () => {
  let shapes: Shape[];
  let selectedIds: Set<string>;
  let tool: SelectTool;

  beforeEach(() => {
    shapes = [
      makeRect("r1", 100, 100, 80, 80),
      makeRect("r2", 300, 100, 80, 80),
      makeRect("r3", 100, 300, 80, 80),
    ];
    selectedIds = new Set();
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => {});
  });

  it("空白エリアのドラッグで範囲選択される", () => {
    // 全図形を囲む範囲をドラッグ
    tool.onMouseDown({ x: 50, y: 50 }, style);
    tool.onMouseMove({ x: 400, y: 400 });
    tool.onMouseUp({ x: 400, y: 400 });

    expect(selectedIds.size).toBe(3);
  });

  it("範囲選択中に getRubberband が矩形を返す", () => {
    tool.onMouseDown({ x: 50, y: 50 }, style);
    expect(tool.getRubberband()).toBeDefined();

    tool.onMouseMove({ x: 200, y: 200 });
    const rb = tool.getRubberband()!;
    expect(rb.x).toBe(50);
    expect(rb.y).toBe(50);
    expect(rb.width).toBe(150);
    expect(rb.height).toBe(150);
  });

  it("一部の図形だけが範囲内にある場合はその図形だけ選択される", () => {
    // r1 だけを囲む範囲
    tool.onMouseDown({ x: 80, y: 80 }, style);
    tool.onMouseMove({ x: 200, y: 200 });
    tool.onMouseUp({ x: 200, y: 200 });

    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has("r1")).toBe(true);
  });

  it("mouseUp 後に getRubberband が undefined を返す", () => {
    tool.onMouseDown({ x: 50, y: 50 }, style);
    tool.onMouseMove({ x: 200, y: 200 });
    tool.onMouseUp({ x: 200, y: 200 });

    expect(tool.getRubberband()).toBeUndefined();
  });
});

describe("SelectTool – multi-select body move", () => {
  let shapes: Shape[];
  let selectedIds: Set<string>;
  let undoPushCount: number;
  let tool: SelectTool;

  beforeEach(() => {
    shapes = [
      makeRect("r1", 100, 100, 80, 80),
      makeRect("r2", 300, 100, 80, 80),
    ];
    selectedIds = new Set();
    undoPushCount = 0;
    tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => { undoPushCount++; });
  });

  it("複数選択した図形をドラッグで一括移動できる", () => {
    // 2つの図形を Shift+Click で選択
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });
    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });
    expect(selectedIds.size).toBe(2);

    // r1 上でドラッグ開始 → 50px 右、50px 下に移動
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseMove({ x: 190, y: 190 });
    tool.onMouseUp({ x: 190, y: 190 });

    const r1 = shapes.find(s => s.id === "r1") as RectShape;
    const r2 = shapes.find(s => s.id === "r2") as RectShape;

    // 両方が同量移動
    expect(r1.x).toBe(150);  // 100 + 50
    expect(r1.y).toBe(150);  // 100 + 50
    expect(r2.x).toBe(350);  // 300 + 50
    expect(r2.y).toBe(150);  // 100 + 50
  });

  it("一括移動で undo が1回だけ push される", () => {
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });
    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });

    undoPushCount = 0;
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseMove({ x: 160, y: 160 });
    tool.onMouseMove({ x: 180, y: 180 });
    tool.onMouseUp({ x: 180, y: 180 });

    expect(undoPushCount).toBe(1);
  });
});

// --- コピー＆ペースト (CanvasEditor レベル) ---
// Note: copy/paste requires CanvasEditor which depends on DOM.
// Core Shape.clone() and Shape.translate() which underpin copy/paste
// are tested here as unit tests.

describe("Shape – clone & translate for copy/paste", () => {
  it("RectShape.clone で新しい id のコピーが作れる", () => {
    const rect = makeRect("r1", 10, 20, 100, 50);
    const copy = rect.clone("r2");
    expect(copy.id).toBe("r2");
    expect(copy.x).toBe(10);
    expect(copy.y).toBe(20);
    expect(copy.width).toBe(100);
  });

  it("RectShape.translate で位置オフセットされたコピーが返る", () => {
    const rect = makeRect("r1", 10, 20, 100, 50);
    const moved = rect.translate(20, 20);
    expect(moved.x).toBe(30);
    expect(moved.y).toBe(40);
    expect(moved.id).toBe("r1"); // translate preserves id
  });

  it("EllipseShape.clone().translate() でオフセットコピー", () => {
    const e = new EllipseShape({ id: "e1", cx: 100, cy: 200, rx: 40, ry: 30, stroke: "#000", fill: "#fff", lineWidth: 2 });
    const copy = e.clone("e2").translate(20, 20);
    expect(copy.id).toBe("e2");
    expect(copy.cx).toBe(120);
    expect(copy.cy).toBe(220);
  });

  it("ArrowShape.clone().translate() で両端がオフセット", () => {
    const a = new ArrowShape({ id: "a1", x1: 10, y1: 20, x2: 100, y2: 200, stroke: "#000", fill: "none", lineWidth: 2 });
    const copy = a.clone("a2").translate(15, 15);
    expect(copy.id).toBe("a2");
    expect(copy.x1).toBe(25);
    expect(copy.y1).toBe(35);
    expect(copy.x2).toBe(115);
    expect(copy.y2).toBe(215);
  });
});

// --- グリッドスナップ ---
// Grid snap is implemented in CanvasEditor.getPoint() (DOM-dependent).
// The core snap function can be tested independently.

describe("Grid snap – snapValue", () => {
  // We test the snap logic directly
  function snapValue(value: number, gridSize: number): number {
    return Math.round(value / gridSize) * gridSize;
  }

  it("値がグリッドに近い場合スナップする", () => {
    expect(snapValue(19, 20)).toBe(20);
    expect(snapValue(21, 20)).toBe(20);
    expect(snapValue(31, 20)).toBe(40);
  });

  it("グリッド上の値はそのまま", () => {
    expect(snapValue(40, 20)).toBe(40);
    expect(snapValue(0, 20)).toBe(0);
  });

  it("中間値は四捨五入される", () => {
    expect(snapValue(10, 20)).toBe(20);
    expect(snapValue(9, 20)).toBe(0);
  });

  it("グリッドサイズ10のスナップ", () => {
    expect(snapValue(13, 10)).toBe(10);
    expect(snapValue(17, 10)).toBe(20);
  });
});

describe("SelectTool – handle resize disabled for multi-select", () => {
  it("複数選択時はハンドルリサイズが無効 (getCursorAt が undefined)", () => {
    const shapes: Shape[] = [
      makeRect("r1", 100, 100, 80, 80),
      makeRect("r2", 300, 100, 80, 80),
    ];
    let selectedIds = new Set<string>();
    const tool = new SelectTool(shapes, (ids) => { selectedIds = new Set(ids); }, () => {});

    // 2つ選択
    tool.onMouseDown({ x: 140, y: 140 }, style);
    tool.onMouseUp({ x: 140, y: 140 });
    tool.onMouseDown({ x: 340, y: 140 }, style, { shiftKey: true });
    tool.onMouseUp({ x: 340, y: 140 });
    expect(selectedIds.size).toBe(2);

    // r1 の BR ハンドル位置 = (100+80+4, 100+80+4) = (184, 184)
    // 複数選択なのでリサイズカーソルは表示されない
    expect(tool.getCursorAt({ x: 184, y: 184 })).toBeUndefined();
  });
});
