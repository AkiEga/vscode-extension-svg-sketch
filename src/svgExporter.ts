import { type Shape, type DiagramData, type ShapeJSON, TableShape, reviveShapes } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

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

  for (const shape of shapes) {
    const common = `data-shape-id="${shape.id}" stroke="${shape.stroke}" fill="${shape.fill}" stroke-width="${shape.lineWidth}"`;
    switch (shape.type) {
      case "rect":
        lines.push(
          `  <rect ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"/>`
        );
        break;
      case "ellipse":
        lines.push(
          `  <ellipse ${common} cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"/>`
        );
        break;
      case "arrow":
        lines.push(
          `  <line ${common} x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" marker-end="url(#arrowhead)" style="color:${shape.stroke}"/>`
        );
        break;
      case "text":
        lines.push(
          `  <text ${common} x="${shape.x}" y="${shape.y}" font-size="${shape.fontSize}" font-family="sans-serif">${escapeXml(shape.text)}</text>`
        );
        break;
      case "table":
        lines.push(...renderTableSvg(shape, common));
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
  lines.push(`    <rect x="${x}" y="${y}" width="${width}" height="${rowH}" fill="#e5e7eb" stroke="none"/>`);
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
        lines.push(`    <text x="${tx}" y="${ty}" font-size="${fontSize}" font-family="sans-serif" fill="${shape.stroke}" dominant-baseline="central">${escapeXml(text)}</text>`);
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
