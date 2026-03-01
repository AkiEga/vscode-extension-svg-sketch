import { Shape, ArrowShape, TableShape } from "../shared";
import type { Point } from "../shared";
import { getShapeHandles } from "./tools/SelectTool";

const HANDLE_SIZE = 6;

/** Render all shapes onto a canvas 2D context */
export function renderShapes(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  preview: Shape | undefined,
  selectedId: string | undefined,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Draw grid
  drawGrid(ctx);

  // Draw all shapes
  for (const shape of shapes) {
    drawShape(ctx, shape);
    if (shape.id === selectedId) {
      drawSelectionIndicator(ctx, shape);
    }
  }

  // Draw preview (semi-transparent)
  if (preview) {
    ctx.globalAlpha = 0.5;
    drawShape(ctx, preview);
    ctx.globalAlpha = 1.0;
  }
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas;
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
  ctx.strokeStyle = shape.stroke;
  ctx.fillStyle = shape.fill;
  ctx.lineWidth = shape.lineWidth;

  switch (shape.type) {
    case "rect":
      if (shape.fill !== "none" && shape.fill !== "transparent") {
        ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
      }
      ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
      break;

    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(shape.cx, shape.cy, Math.max(shape.rx, 0), Math.max(shape.ry, 0), 0, 0, Math.PI * 2);
      if (shape.fill !== "none" && shape.fill !== "transparent") {
        ctx.fill();
      }
      ctx.stroke();
      break;

    case "arrow":
      drawArrow(ctx, shape.x1, shape.y1, shape.x2, shape.y2);
      break;

    case "text":
      ctx.font = `${shape.fontSize}px sans-serif`;
      ctx.fillStyle = shape.stroke; // text rendered with stroke color
      ctx.fillText(shape.text, shape.x, shape.y);
      break;

    case "table":
      drawTable(ctx, shape);
      break;
  }
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
  ctx.fillStyle = "#e5e7eb";
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
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = shape.stroke;
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

  // For arrows, also draw endpoint handles
  if (shape instanceof ArrowShape) {
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
  }

  ctx.restore();
}
