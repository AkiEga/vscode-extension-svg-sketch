import { type Shape, type ConcreteShape, type DiagramData, type ShapeJSON, TableShape, reviveShapes } from "./types";
import { shapeDefaults } from "./shapeConfig";

const SVG_NS = "http://www.w3.org/2000/svg";

// ── Sketch helpers for SVG export ────────────────────────────────

/** Seeded LCG PRNG, returns [0, 1) */
function sketchRand(seed: number): () => number {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Derive a stable seed from a shape id */
function svgSeed(id: string): number {
  let h = 0x12345678;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h ^ id.charCodeAt(i), 0x9e3779b9)) >>> 0;
  }
  return h;
}

/** Format a number to 2 decimal places for SVG path data */
function sv(v: number): string { return v.toFixed(2); }

/** One sketchy quadratic-bezier segment as an SVG path fragment */
function sketchySvgSegment(x1: number, y1: number, x2: number, y2: number, rand: () => number): string {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = len > 0.1 ? -dy / len : 0;
  const ny = len > 0.1 ? dx / len : 0;
  const r = () => rand() - 0.5;
  const mag = Math.min(3, len * 0.015 + 1);
  const cpx = (x1 + x2) / 2 + nx * r() * mag * 2 + r() * mag;
  const cpy = (y1 + y2) / 2 + ny * r() * mag * 2 + r() * mag;
  const sx = x1 + r() * 1.2, sy = y1 + r() * 1.2;
  const ex = x2 + r() * 1.2, ey = y2 + r() * 1.2;
  return `M ${sv(sx)} ${sv(sy)} Q ${sv(cpx)} ${sv(cpy)} ${sv(ex)} ${sv(ey)}`;
}

/** Four sketchy sides of a rectangle as an SVG path d attribute value */
function sketchySvgRect(x: number, y: number, w: number, h: number, rand: () => number): string {
  const ov = () => (rand() - 0.5) * 2.5;
  return [
    sketchySvgSegment(x + ov(), y + ov(), x + w + ov(), y + ov(), rand),
    sketchySvgSegment(x + w + ov(), y + ov(), x + w + ov(), y + h + ov(), rand),
    sketchySvgSegment(x + w + ov(), y + h + ov(), x + ov(), y + h + ov(), rand),
    sketchySvgSegment(x + ov(), y + h + ov(), x + ov(), y + ov(), rand),
  ].join(" ");
}

/** Sketchy ellipse as an SVG path d attribute value */
function sketchySvgEllipse(cx: number, cy: number, rx: number, ry: number, rand: () => number): string {
  const segs = Math.max(20, Math.round(Math.PI * (rx + ry) * 0.5));
  const tStart = (rand() - 0.5) * 0.3;
  const pts: string[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = tStart + (i / segs) * (Math.PI * 2 + 0.12);
    const wobble = 1 + (rand() - 0.5) * 0.05;
    const px = cx + Math.cos(t) * rx * wobble;
    const py = cy + Math.sin(t) * ry * wobble;
    pts.push(i === 0 ? `M ${sv(px)} ${sv(py)}` : `L ${sv(px)} ${sv(py)}`);
  }
  return pts.join(" ");
}

/** Convert an array of shapes to an SVG string */
export function shapesToSvg(shapes: Shape[], width = 800, height = 600): string {
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`,
    `  data-editor="svg-sketch"`,
    `  data-diagram='${JSON.stringify({ version: 1, shapes } satisfies DiagramData)}'>`,
  );

  // Arrow marker definition
  lines.push("  <defs>");
  lines.push(
    '    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">',
    '      <polygon points="0 0, 10 3.5, 0 7" fill="currentColor"/>',
    "    </marker>",
  );
  lines.push("  </defs>");

  for (const shape of shapes as ConcreteShape[]) {
    const common = `data-shape-id="${shape.id}" stroke="${shape.stroke}" fill="${shape.fill}" stroke-width="${shape.lineWidth}"`;
    switch (shape.type) {
      case "rect": {
        const rand = sketchRand(svgSeed(shape.id));
        // Clean fill rectangle
        if (shape.fill !== "none" && shape.fill !== "transparent") {
          lines.push(`  <rect data-shape-id="${shape.id}" fill="${shape.fill}" stroke="none" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"/>`);
        }
        // Sketchy stroke path
        if (shape.lineWidth > 0 && shape.stroke !== "none" && shape.stroke !== "transparent") {
          const d = sketchySvgRect(shape.x, shape.y, shape.width, shape.height, rand);
          lines.push(`  <path data-shape-id="${shape.id}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}" d="${d}"/>`);
        }
        if (shape.label) {
          const lx = shape.x + shape.width / 2;
          const ly = shape.y + shape.height / 2;
          const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
          const ff = shape.labelFontFamily ?? shapeDefaults.fontFamily;
          const fc = shape.labelFontColor ?? shape.stroke;
          lines.push(labelToSvgText(shape.label, lx, ly, fs, ff, fc));
        }
        break;
      }
      case "ellipse": {
        const rand = sketchRand(svgSeed(shape.id));
        // Clean fill ellipse
        if (shape.fill !== "none" && shape.fill !== "transparent") {
          lines.push(`  <ellipse data-shape-id="${shape.id}" fill="${shape.fill}" stroke="none" cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"/>`);
        }
        // Sketchy stroke path
        if (shape.lineWidth > 0 && shape.stroke !== "none" && shape.stroke !== "transparent") {
          const d = sketchySvgEllipse(shape.cx, shape.cy, Math.max(shape.rx, 0), Math.max(shape.ry, 0), rand);
          lines.push(`  <path data-shape-id="${shape.id}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}" d="${d}"/>`);
        }
        if (shape.label) {
          const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
          const ff = shape.labelFontFamily ?? shapeDefaults.fontFamily;
          const fc = shape.labelFontColor ?? shape.stroke;
          lines.push(labelToSvgText(shape.label, shape.cx, shape.cy, fs, ff, fc));
        }
        break;
      }
      case "arrow": {
        const rand = sketchRand(svgSeed(shape.id));
        const r = () => rand() - 0.5;
        // Sketchy shaft
        const shaftD = sketchySvgSegment(shape.x1, shape.y1, shape.x2, shape.y2, rand);
        lines.push(`  <path data-shape-id="${shape.id}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}" d="${shaftD}"/>`);
        // Sketchy arrowhead
        const headLen = 12;
        const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
        const ex = shape.x2 + r() * 1.0, ey = shape.y2 + r() * 1.0;
        const hx1 = shape.x2 - headLen * Math.cos(angle - Math.PI / 6) + r() * 1.5;
        const hy1 = shape.y2 - headLen * Math.sin(angle - Math.PI / 6) + r() * 1.5;
        const hx2 = shape.x2 - headLen * Math.cos(angle + Math.PI / 6) + r() * 1.5;
        const hy2 = shape.y2 - headLen * Math.sin(angle + Math.PI / 6) + r() * 1.5;
        lines.push(`  <polygon data-shape-id="${shape.id}" fill="${shape.stroke}" stroke="none" points="${sv(ex)},${sv(ey)} ${sv(hx1)},${sv(hy1)} ${sv(hx2)},${sv(hy2)}"/>`);
        if (shape.label) {
          const lx = (shape.x1 + shape.x2) / 2;
          const ly = (shape.y1 + shape.y2) / 2 - 10;
          const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
          const ff = shape.labelFontFamily ?? shapeDefaults.fontFamily;
          const fc = shape.labelFontColor ?? shape.stroke;
          lines.push(labelToSvgText(shape.label, lx, ly, fs, ff, fc));
        }
        break;
      }
      case "bubble": {
        const rand = sketchRand(svgSeed(shape.id));
        const wb = () => (rand() - 0.5) * 2;
        const x = shape.x;
        const y = shape.y;
        const w = shape.width;
        const h = shape.height;
        const tailW = Math.min(24, w * 0.25);
        const tailH = Math.min(18, h * 0.25);
        const tailX = x + w * 0.35;
        const path = [
          `M ${sv(x + wb())} ${sv(y + wb())}`,
          `L ${sv(x + w + wb())} ${sv(y + wb())}`,
          `L ${sv(x + w + wb())} ${sv(y + h + wb())}`,
          `L ${sv(tailX + tailW + wb())} ${sv(y + h + wb())}`,
          `L ${sv(tailX + tailW * 0.4 + wb())} ${sv(y + h + tailH + wb())}`,
          `L ${sv(tailX + wb())} ${sv(y + h + wb())}`,
          `L ${sv(x + wb())} ${sv(y + h + wb())}`,
          "Z",
        ].join(" ");
        lines.push(`  <path ${common} d="${path}"/>`);
        if (shape.label) {
          const lx = shape.x + shape.width / 2;
          const ly = shape.y + shape.height / 2;
          const fs = shape.labelFontSize ?? shapeDefaults.fontSize;
          const ff = shape.labelFontFamily ?? shapeDefaults.fontFamily;
          const fc = shape.labelFontColor ?? shape.stroke;
          lines.push(labelToSvgText(shape.label, lx, ly, fs, ff, fc));
        }
        break;
      }
      case "text":
        lines.push(
          `  <text ${common} x="${shape.x}" y="${shape.y}" font-size="${shape.fontSize}" font-family="${shape.fontFamily ?? shapeDefaults.fontFamily}" fill="${shape.fontColor ?? shape.stroke}">${escapeXml(shape.text)}</text>`
        );
        break;
      case "table":
        lines.push(...renderTableSvg(shape, common));
        break;
      case "image":
        lines.push(
          `  <image ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" href="${escapeXml(shape.dataUrl)}" preserveAspectRatio="none"/>`
        );
        break;
    }
  }

  lines.push("</svg>");
  return lines.join("\n");
}

/** Parse diagram data from SVG content */
export function parseDiagramData(svgContent: string): DiagramData | undefined {
  const match = svgContent.match(/data-diagram='([^']*)'/);
  if (!match) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(match[1]) as { version: 1; shapes: ShapeJSON[] };
    return { version: parsed.version, shapes: reviveShapes(parsed.shapes) };
  } catch {
    return undefined;
  }
}

function renderTableSvg(shape: TableShape, common: string): string[] {
  const { x, y, width, height, rows, cols, cells, fontSize } = shape;
  const colW = width / cols;
  const rowH = height / rows;
  const lines: string[] = [];
  lines.push(`  <g ${common} data-table-rows="${rows}" data-table-cols="${cols}">`);
  // Background
  lines.push(`    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}"/>`);
  // Header background
  lines.push(`    <rect x="${x}" y="${y}" width="${width}" height="${rowH}" fill="${shapeDefaults.tableHeaderBg}" stroke="none"/>`);
  // Grid lines
  for (let r = 1; r < rows; r++) {
    lines.push(`    <line x1="${x}" y1="${y + r * rowH}" x2="${x + width}" y2="${y + r * rowH}" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}"/>`);
  }
  for (let c = 1; c < cols; c++) {
    lines.push(`    <line x1="${x + c * colW}" y1="${y}" x2="${x + c * colW}" y2="${y + height}" stroke="${shape.stroke}" stroke-width="${shape.lineWidth}"/>`);
  }
  // Cell text
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const text = cells[r]?.[c];
      if (text) {
        const tx = x + c * colW + 6;
        const ty = y + r * rowH + rowH / 2;
        lines.push(`    <text x="${tx}" y="${ty}" font-size="${fontSize}" font-family="${shape.fontFamily ?? shapeDefaults.fontFamily}" fill="${shape.fontColor ?? shape.stroke}" dominant-baseline="central">${escapeXml(text)}</text>`);
      }
    }
  }
  lines.push("  </g>");
  return lines;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ラベル文字列を SVG <text> 要素に変換する。\n を <tspan> で複数行に展開する。 */
export function labelToSvgText(
  label: string,
  x: number,
  y: number,
  fontSize: number,
  fontFamily: string,
  fontColor: string,
  attrs = "",
): string {
  const lines = label.split("\n");
  if (lines.length === 1) {
    return `  <text x="${x}" y="${y}" font-size="${fontSize}" font-family="${fontFamily}" fill="${fontColor}" text-anchor="middle" dominant-baseline="central"${attrs}>${escapeXml(label)}</text>`;
  }
  const lineHeight = fontSize * 1.4;
  const startY = y - (lines.length - 1) * lineHeight / 2;
  const tspans = lines.map((line, i) =>
    `    <tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
  ).join("\n");
  return `  <text x="${x}" y="${startY}" font-size="${fontSize}" font-family="${fontFamily}" fill="${fontColor}" text-anchor="middle" dominant-baseline="middle"${attrs}>\n${tspans}\n  </text>`;
}
