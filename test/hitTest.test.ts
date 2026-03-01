import { describe, it, expect } from "vitest";
import { hitTest } from "../webview/shared";
import type { RectShape, EllipseShape, ArrowShape, TextShape } from "../src/types";

// --- FR-2 Select: hitTest によるクリック選択判定 ---

describe("hitTest", () => {

  // --- Rect ---
  describe("rect", () => {
    const rect: RectShape = {
      id: "r1", type: "rect", x: 100, y: 100, width: 200, height: 100,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    };

    it("矩形の内部でヒットする", () => {
      expect(hitTest(rect, { x: 150, y: 150 })).toBe(true);
    });

    it("矩形の左上角でヒットする", () => {
      expect(hitTest(rect, { x: 100, y: 100 })).toBe(true);
    });

    it("矩形の右下角でヒットする", () => {
      expect(hitTest(rect, { x: 300, y: 200 })).toBe(true);
    });

    it("tolerance 範囲内でヒットする (境界の少し外)", () => {
      expect(hitTest(rect, { x: 95, y: 100 }, 6)).toBe(true);
    });

    it("tolerance 範囲外でヒットしない", () => {
      expect(hitTest(rect, { x: 50, y: 50 })).toBe(false);
    });

    it("矩形の遠く外側でヒットしない", () => {
      expect(hitTest(rect, { x: 500, y: 500 })).toBe(false);
    });
  });

  // --- Ellipse ---
  describe("ellipse", () => {
    const ellipse: EllipseShape = {
      id: "e1", type: "ellipse", cx: 200, cy: 200, rx: 80, ry: 50,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    };

    it("楕円の中心でヒットする", () => {
      expect(hitTest(ellipse, { x: 200, y: 200 })).toBe(true);
    });

    it("楕円の内部でヒットする", () => {
      expect(hitTest(ellipse, { x: 230, y: 210 })).toBe(true);
    });

    it("楕円の外側でヒットしない", () => {
      expect(hitTest(ellipse, { x: 400, y: 400 })).toBe(false);
    });

    it("楕円の長軸端付近 (tolerance内) でヒットする", () => {
      // rx=80, cx=200 → 右端 x=280, tolerance=6 → x=285 はまだ中
      expect(hitTest(ellipse, { x: 285, y: 200 }, 6)).toBe(true);
    });
  });

  // --- Arrow ---
  describe("arrow", () => {
    const arrow: ArrowShape = {
      id: "a1", type: "arrow", x1: 100, y1: 100, x2: 300, y2: 100,
      stroke: "#000", fill: "none", lineWidth: 2,
    };

    it("線分上の点でヒットする", () => {
      expect(hitTest(arrow, { x: 200, y: 100 })).toBe(true);
    });

    it("線分の始点でヒットする", () => {
      expect(hitTest(arrow, { x: 100, y: 100 })).toBe(true);
    });

    it("線分の終点でヒットする", () => {
      expect(hitTest(arrow, { x: 300, y: 100 })).toBe(true);
    });

    it("線分から tolerance 内の距離でヒットする", () => {
      // 水平線 y=100, tolerance=6+lineWidth=2 → y=107 はヒット
      expect(hitTest(arrow, { x: 200, y: 107 })).toBe(true);
    });

    it("線分から遠い点でヒットしない", () => {
      expect(hitTest(arrow, { x: 200, y: 150 })).toBe(false);
    });

    it("斜め矢印の中点でヒットする", () => {
      const diag: ArrowShape = {
        id: "a2", type: "arrow", x1: 0, y1: 0, x2: 100, y2: 100,
        stroke: "#000", fill: "none", lineWidth: 2,
      };
      expect(hitTest(diag, { x: 50, y: 50 })).toBe(true);
    });

    it("長さゼロの矢印 (同一点) でヒットする", () => {
      const zero: ArrowShape = {
        id: "a3", type: "arrow", x1: 50, y1: 50, x2: 50, y2: 50,
        stroke: "#000", fill: "none", lineWidth: 2,
      };
      expect(hitTest(zero, { x: 50, y: 50 })).toBe(true);
    });
  });

  // --- Text ---
  describe("text", () => {
    const text: TextShape = {
      id: "t1", type: "text", x: 100, y: 200, text: "Hello",
      fontSize: 16, stroke: "#000", fill: "#000", lineWidth: 1,
    };

    it("テキスト領域内でヒットする", () => {
      // テキストの高さは y-fontSize 〜 y の範囲
      expect(hitTest(text, { x: 110, y: 190 })).toBe(true);
    });

    it("テキスト位置 (x,y) の付近でヒットする", () => {
      expect(hitTest(text, { x: 100, y: 200 })).toBe(true);
    });

    it("テキスト領域外でヒットしない", () => {
      expect(hitTest(text, { x: 500, y: 500 })).toBe(false);
    });

    it("テキストの上方 (fontSize 分上) の境界付近でヒットする", () => {
      // y=200, fontSize=16 → 上端は y-fontSize=184, tolerance=6 → y=179 はヒット
      expect(hitTest(text, { x: 110, y: 179 }, 6)).toBe(true);
    });
  });
});
