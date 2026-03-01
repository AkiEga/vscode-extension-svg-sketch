import { describe, it, expect } from "vitest";
import type { Shape } from "../src/types";
import { getShapesBounds, prepareTemplateInsertion } from "../webview/canvas/templateInsert";

describe("templateInsert", () => {
  it("computes bounds for mixed shapes", () => {
    const shapes: Shape[] = [
      { id: "r1", type: "rect", x: 10, y: 20, width: 100, height: 50, stroke: "#000", fill: "#fff", lineWidth: 2 },
      { id: "e1", type: "ellipse", cx: 200, cy: 100, rx: 20, ry: 10, stroke: "#000", fill: "#fff", lineWidth: 2 },
    ];

    const bounds = getShapesBounds(shapes);
    expect(bounds).toBeDefined();
    expect(bounds!.minX).toBe(10);
    expect(bounds!.minY).toBe(20);
    expect(bounds!.maxX).toBe(220);
    expect(bounds!.maxY).toBe(110);
  });

  it("returns unique ids and non-zero offset when existing diagram overlaps", () => {
    const existing: Shape[] = [
      { id: "s1", type: "rect", x: 0, y: 0, width: 180, height: 100, stroke: "#000", fill: "#fff", lineWidth: 2 },
    ];
    const incoming: Shape[] = [
      { id: "s1", type: "rect", x: 0, y: 0, width: 120, height: 80, stroke: "#000", fill: "#fff", lineWidth: 2 },
      { id: "s2", type: "text", x: 20, y: 40, text: "Step 1", fontSize: 16, stroke: "#000", fill: "#000", lineWidth: 1 },
    ];

    const result = prepareTemplateInsertion(existing, incoming);
    expect(result.shapes).toHaveLength(2);
    expect(result.dx).toBeGreaterThan(0);
    expect(result.dy).toBeGreaterThan(0);

    for (const shape of result.shapes) {
      expect(shape.id).not.toBe("s1");
      expect(shape.id.startsWith("tpl_")).toBe(true);
    }

    expect(result.insertedIds).toEqual(result.shapes.map((s) => s.id));
  });

  it("keeps placement when canvas is empty", () => {
    const incoming: Shape[] = [
      { id: "r1", type: "rect", x: 15, y: 25, width: 100, height: 50, stroke: "#000", fill: "#fff", lineWidth: 2 },
    ];

    const result = prepareTemplateInsertion([], incoming);
    const rect = result.shapes[0];

    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(rect.type).toBe("rect");
    if (rect.type === "rect") {
      expect(rect.x).toBe(15);
      expect(rect.y).toBe(25);
    }
  });
});
