import { Shape, RectShape, EllipseShape, ArrowShape, TableShape, BubbleShape, TextShape, ImageShape } from "../shared";
import type { Point } from "../shared";
import { shapeDefaults } from "../shared";
import { getShapeHandles } from "./tools/SelectTool";
import type { RubberBand } from "./tools/SelectTool";

const HANDLE_SIZE = 6;
const imageCache = new Map<string, HTMLImageElement>();

function hasVisibleStroke(shape: Shape): boolean {
  return shape.lineWidth > 0 && shape.stroke !== "none" && shape.stroke !== "transparent";
}

/** Render all shapes onto a canvas 2D context */
export function renderShapes(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  preview: Shape | undefined,
  selectedIds: Set<string>,
  rubberBand?: RubberBand,
): void {
  // Clear full physical canvas (transform-independent)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  // Draw grid
  drawGrid(ctx);

  // Draw all shapes
  for (const shape of shapes) {
    drawShape(ctx, shape);
    if (selectedIds.has(shape.id)) {
      drawSelectionIndicator(ctx, shape);
    }
  }

  // Draw preview (semi-transparent)
  if (preview) {
    ctx.globalAlpha = 0.5;
    drawShape(ctx, preview);
    ctx.globalAlpha = 1.0;
  }

  // Draw rubber-band selection marquee
  if (rubberBand) {
    drawRubberBand(ctx, rubberBand);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;
  const width = ctx.canvas.width / dpr;
  const height = ctx.canvas.height / dpr;
  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 0.5;
  const step = 20;
  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const drawStroke = hasVisibleStroke(shape);
  if (drawStroke) {
    ctx.strokeStyle = shape.stroke;
  }
  ctx.fillStyle = shape.fill;
  ctx.lineWidth = drawStroke ? shape.lineWidth : 0;

  switch (shape.type) {
    case "rect": {
      const s = shape as RectShape;
      if (s.fill !== "none" && s.fill !== "transparent") {
        ctx.fillRect(s.x, s.y, s.width, s.height);
      }
      if (drawStroke) {
        ctx.strokeRect(s.x, s.y, s.width, s.height);
      }
      drawShapeLabel(ctx, s, s.x + s.width / 2, s.y + s.height / 2);
      break;
    }

    case "ellipse": {
      const s = shape as EllipseShape;
      ctx.beginPath();
      ctx.ellipse(s.cx, s.cy, Math.max(s.rx, 0), Math.max(s.ry, 0), 0, 0, Math.PI * 2);
      if (s.fill !== "none" && s.fill !== "transparent") {
        ctx.fill();
      }
      if (drawStroke) {
        ctx.stroke();
      }
      drawShapeLabel(ctx, s, s.cx, s.cy);
      break;
    }

    case "arrow": {
      const s = shape as ArrowShape;
      drawArrow(ctx, s.x1, s.y1, s.x2, s.y2);
      drawShapeLabel(ctx, s, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2 - 10);
      break;
    }

    case "bubble": {
      const s = shape as BubbleShape;
      drawBubble(ctx, s);
      drawShapeLabel(ctx, s, s.x + s.width / 2, s.y + s.height / 2);
      break;
    }

    case "text": {
      const s = shape as TextShape;
      ctx.font = `${s.fontSize}px ${s.fontFamily ?? shapeDefaults.fontFamily}`;
      ctx.fillStyle = s.fontColor ?? s.stroke;
      ctx.fillText(s.text, s.x, s.y);
      break;
    }

    case "table": {
      const s = shape as TableShape;
      drawTable(ctx, s);
      break;
    }

    case "image": {
      const s = shape as ImageShape;
      drawImageShape(ctx, s, drawStroke);
      break;
    }
  }
}

function drawImageShape(ctx: CanvasRenderingContext2D, shape: ImageShape, drawStroke: boolean): void {
  let img = imageCache.get(shape.id);
  if (!img || img.src !== shape.dataUrl) {
    img = new Image();
    img.src = shape.dataUrl;
    img.onload = () => {
      // image onload redraws on next render cycle; no-op here because caller re-renders frequently.
    };
    imageCache.set(shape.id, img);
  }

  if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    ctx.drawImage(img, shape.x, shape.y, shape.width, shape.height);
  } else {
    ctx.save();
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
    ctx.restore();
  }

  if (drawStroke) {
    ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
  }
}

function drawBubble(ctx: CanvasRenderingContext2D, shape: BubbleShape): void {
  const drawStroke = hasVisibleStroke(shape);
  const radius = 10;
  const x = shape.x;
  const y = shape.y;
  const w = shape.width;
  const h = shape.height;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + w * 0.6, y + h);
  ctx.lineTo(x + w * 0.5, y + h + 16);
  ctx.lineTo(x + w * 0.45, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  if (shape.fill !== "none" && shape.fill !== "transparent") {
    ctx.fill();
  }
  if (drawStroke) {
    ctx.stroke();
  }
}

function drawShapeLabel(
  ctx: CanvasRenderingContext2D,
  shape: Shape & { label?: string; labelFontSize?: number; labelFontFamily?: string; labelFontColor?: string; stroke: string },
  x: number,
  y: number,
): void {
  if (!shape.label) { return; }
  ctx.save();
  const fontSize = shape.labelFontSize ?? shapeDefaults.fontSize;
  ctx.font = `${fontSize}px ${shape.labelFontFamily ?? shapeDefaults.fontFamily}`;
  ctx.fillStyle = shape.labelFontColor ?? shape.stroke;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = shape.label.split("\n");
  const lineHeight = fontSize * 1.4;
  const startY = y - (lines.length - 1) * lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, startY + i * lineHeight);
  }
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
): void {
  const headLen = 12;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  // Line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

function drawTable(ctx: CanvasRenderingContext2D, shape: TableShape): void {
  const { x, y, width, height, rows, cols, cells, fontSize } = shape;
  const colW = width / cols;
  const rowH = height / rows;

  // Fill background
  if (shape.fill !== "none" && shape.fill !== "transparent") {
    ctx.fillRect(x, y, width, height);
  }

  // Outer border
  ctx.strokeRect(x, y, width, height);

  // Header row background
  ctx.save();
  ctx.fillStyle = shapeDefaults.tableHeaderBg;
  ctx.fillRect(x, y, width, rowH);
  ctx.restore();

  // Horizontal lines
  for (let r = 1; r < rows; r++) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * rowH);
    ctx.lineTo(x + width, y + r * rowH);
    ctx.stroke();
  }

  // Vertical lines
  for (let c = 1; c < cols; c++) {
    ctx.beginPath();
    ctx.moveTo(x + c * colW, y);
    ctx.lineTo(x + c * colW, y + height);
    ctx.stroke();
  }

  // Cell text
  ctx.save();
  ctx.font = `${fontSize}px ${shape.fontFamily ?? shapeDefaults.fontFamily}`;
  ctx.fillStyle = shape.fontColor ?? shape.stroke;
  ctx.textBaseline = "middle";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const text = cells[r]?.[c] ?? "";
      if (text) {
        const cellX = x + c * colW + 6;
        const cellY = y + r * rowH + rowH / 2;
        ctx.fillText(text, cellX, cellY, colW - 12);
      }
    }
  }
  ctx.restore();
}

function drawSelectionIndicator(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.save();
  ctx.strokeStyle = "#4a90d9";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);

  if (shape instanceof ArrowShape) {
    // Arrow selection uses line-based highlight rather than bounding rectangle.
    ctx.beginPath();
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "#d94a4a";
    const endpoints = [
      { x: shape.x1, y: shape.y1 },
      { x: shape.x2, y: shape.y2 },
    ];
    for (const ep of endpoints) {
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, HANDLE_SIZE, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const h = getShapeHandles(shape);
  const x = h.tl.x, y = h.tl.y;
  const w = h.tr.x - h.tl.x, hh = h.bl.y - h.tl.y;

  ctx.strokeRect(x, y, w, hh);

  // Draw corner handles
  ctx.setLineDash([]);
  ctx.fillStyle = "#4a90d9";
  const corners = [h.tl, h.tr, h.bl, h.br];
  for (const c of corners) {
    ctx.fillRect(c.x - HANDLE_SIZE / 2, c.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }

  ctx.restore();
}

function drawRubberBand(ctx: CanvasRenderingContext2D, rb: RubberBand): void {
  ctx.save();
  ctx.fillStyle = "rgba(74, 144, 217, 0.1)";
  ctx.fillRect(rb.x, rb.y, rb.width, rb.height);
  ctx.strokeStyle = "#4a90d9";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(rb.x, rb.y, rb.width, rb.height);
  ctx.restore();
}
