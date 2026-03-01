import type { Shape, DiagramData } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Convert an array of shapes to an SVG string */
export function shapesToSvg(shapes: Shape[], width = 800, height = 600): string {
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`,
    `  data-editor="markdown-svg-sketch"`,
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
    return JSON.parse(match[1]) as DiagramData;
  } catch {
    return undefined;
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
