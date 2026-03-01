import { describe, it, expect } from "vitest";
import { shapesToSvg, parseDiagramData } from "../src/svgExporter";
import { RectShape, EllipseShape, ArrowShape, TextShape, type Shape } from "../src/types";

// --- FR-4: SVG ファイル保存 ---

describe("shapesToSvg", () => {
  it("空の shapes から有効な SVG を生成する", () => {
    const svg = shapesToSvg([], 800, 600);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="800"');
    expect(svg).toContain('height="600"');
    expect(svg).toContain('data-editor="svg-sketch"');
    expect(svg).toContain("<defs>");
    expect(svg).toContain("</svg>");
  });

  it("rect を正しい SVG 要素に変換する", () => {
    const rect = new RectShape({
      id: "r1", x: 10, y: 20, width: 100, height: 50,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    });
    const svg = shapesToSvg([rect]);
    expect(svg).toContain('<rect');
    expect(svg).toContain('x="10"');
    expect(svg).toContain('y="20"');
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
    expect(svg).toContain('data-shape-id="r1"');
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('stroke-width="2"');
  });

  it("ellipse を正しい SVG 要素に変換する", () => {
    const ellipse = new EllipseShape({
      id: "e1", cx: 100, cy: 100, rx: 50, ry: 30,
      stroke: "#333", fill: "none", lineWidth: 1,
    });
    const svg = shapesToSvg([ellipse]);
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('cx="100"');
    expect(svg).toContain('cy="100"');
    expect(svg).toContain('rx="50"');
    expect(svg).toContain('ry="30"');
  });

  it("arrow を line + arrowhead marker に変換する", () => {
    const arrow = new ArrowShape({
      id: "a1", x1: 0, y1: 0, x2: 100, y2: 100,
      stroke: "#f00", fill: "none", lineWidth: 3,
    });
    const svg = shapesToSvg([arrow]);
    expect(svg).toContain('<line');
    expect(svg).toContain('x1="0"');
    expect(svg).toContain('y1="0"');
    expect(svg).toContain('x2="100"');
    expect(svg).toContain('y2="100"');
    expect(svg).toContain('marker-end="url(#arrowhead)"');
    expect(svg).toContain('id="arrowhead"');
  });

  it("rect の label を中央テキストとして SVG に出力する", () => {
    const rect = new RectShape({
      id: "r1", x: 20, y: 30, width: 120, height: 60,
      stroke: "#123456", fill: "#fff", lineWidth: 2,
      label: "Node", labelFontSize: 18,
    });
    const svg = shapesToSvg([rect]);
    expect(svg).toContain('<rect');
    expect(svg).toContain('<text');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('dominant-baseline="central"');
    expect(svg).toContain('font-size="18"');
    expect(svg).toContain('>Node</text>');
  });

  it("ellipse/arrow の label を SVG に出力する", () => {
    const ellipse = new EllipseShape({
      id: "e1", cx: 100, cy: 120, rx: 40, ry: 24,
      stroke: "#0a0", fill: "none", lineWidth: 2,
      label: "E",
    });
    const arrow = new ArrowShape({
      id: "a1", x1: 10, y1: 10, x2: 100, y2: 70,
      stroke: "#00f", fill: "none", lineWidth: 2,
      label: "Flow",
    });
    const svg = shapesToSvg([ellipse, arrow]);
    expect(svg).toContain('>E</text>');
    expect(svg).toContain('>Flow</text>');
  });

  it("text を正しい SVG 要素に変換し、特殊文字をエスケープする", () => {
    const text = new TextShape({
      id: "t1", x: 50, y: 80, text: '<Hello> & "World"',
      fontSize: 16, stroke: "#000", fill: "#000", lineWidth: 1,
    });
    const svg = shapesToSvg([text]);
    expect(svg).toContain('<text');
    expect(svg).toContain('x="50"');
    expect(svg).toContain('y="80"');
    expect(svg).toContain('font-size="16"');
    expect(svg).toContain("&lt;Hello&gt; &amp; &quot;World&quot;");
    // <text> 要素内ではエスケープされている（data-diagram JSON 内の生テキストは許容）
    expect(svg).toMatch(/<text[^>]*>&lt;Hello&gt;/);
  });

  it("複数の shapes を含む SVG を生成する", () => {
    const shapes: Shape[] = [
      new RectShape({ id: "r1", x: 0, y: 0, width: 50, height: 50, stroke: "#000", fill: "#fff", lineWidth: 1 }),
      new EllipseShape({ id: "e1", cx: 100, cy: 100, rx: 30, ry: 20, stroke: "#000", fill: "#fff", lineWidth: 1 }),
      new ArrowShape({ id: "a1", x1: 50, y1: 25, x2: 70, y2: 100, stroke: "#000", fill: "none", lineWidth: 1 }),
    ];
    const svg = shapesToSvg(shapes);
    expect(svg).toContain('<rect');
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('<line');
  });

  it("カスタム width/height を指定できる", () => {
    const svg = shapesToSvg([], 1024, 768);
    expect(svg).toContain('width="1024"');
    expect(svg).toContain('height="768"');
    expect(svg).toContain('viewBox="0 0 1024 768"');
  });

  it("data-diagram 属性に shapes の JSON を埋め込む", () => {
    const rect = new RectShape({
      id: "r1", x: 10, y: 20, width: 100, height: 50,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    });
    const svg = shapesToSvg([rect]);
    expect(svg).toContain("data-diagram='");
    // JSON should contain the shape data
    const match = svg.match(/data-diagram='([^']*)'/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.version).toBe(1);
    expect(parsed.shapes).toHaveLength(1);
    expect(parsed.shapes[0].id).toBe("r1");
  });
});

// --- FR-6: 既存 SVG の再編集 ---

describe("parseDiagramData", () => {
  it("有効な SVG から DiagramData をパースできる", () => {
    const rect = new RectShape({
      id: "r1", x: 10, y: 20, width: 100, height: 50,
      stroke: "#000", fill: "#fff", lineWidth: 2,
    });
    const svg = shapesToSvg([rect]);
    const data = parseDiagramData(svg);
    expect(data).toBeDefined();
    expect(data!.version).toBe(1);
    expect(data!.shapes).toHaveLength(1);
    expect(data!.shapes[0].type).toBe("rect");
  });

  it("data-diagram 属性がない SVG では undefined を返す", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="100"/></svg>';
    expect(parseDiagramData(svg)).toBeUndefined();
  });

  it("不正な JSON の場合 undefined を返す", () => {
    const svg = `<svg data-diagram='{invalid json}'>`;
    expect(parseDiagramData(svg)).toBeUndefined();
  });

  it("shapesToSvg → parseDiagramData のラウンドトリップが成功する", () => {
    const shapes: Shape[] = [
      new RectShape({ id: "r1", x: 10, y: 20, width: 100, height: 50, stroke: "#000", fill: "#fff", lineWidth: 2 }),
      new EllipseShape({ id: "e1", cx: 200, cy: 150, rx: 60, ry: 40, stroke: "#333", fill: "none", lineWidth: 1 }),
      new ArrowShape({ id: "a1", x1: 110, y1: 45, x2: 140, y2: 150, stroke: "#f00", fill: "none", lineWidth: 2 }),
      new TextShape({ id: "t1", x: 50, y: 300, text: "Hello", fontSize: 16, stroke: "#000", fill: "#000", lineWidth: 1 }),
    ];
    const svg = shapesToSvg(shapes, 800, 600);
    const data = parseDiagramData(svg);
    expect(data).toBeDefined();
    expect(data!.shapes).toHaveLength(4);
    // Verify each shape type preserved
    expect(data!.shapes.map((s) => s.type)).toEqual(["rect", "ellipse", "arrow", "text"]);
    // Verify rect properties
    const r = data!.shapes[0] as RectShape;
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
    expect(r.width).toBe(100);
    expect(r.height).toBe(50);
    // Verify text content
    const t = data!.shapes[3] as TextShape;
    expect(t.text).toBe("Hello");
    expect(t.fontSize).toBe(16);
  });
});
