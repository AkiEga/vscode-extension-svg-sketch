import { Shape, RectShape, EllipseShape, ArrowShape, TableShape, BubbleShape, TextShape, ImageShape } from "../shared";
import type { Point } from "../shared";
import { shapeDefaults } from "../shared";
import { getShapeHandles } from "./tools/SelectTool";
import type { RubberBand } from "./tools/SelectTool";

const HANDLE_SIZE = 6;
const imageCache = new Map<string, HTMLImageElement>();

// ── Sketch / hand-drawn helpers ──────────────────────────────────

/** Simple seeded LCG pseudo-random number generator, returns [0, 1) */
function makeRand(seed: number): () => number {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Derive a stable integer seed from a shape's id string */
function seedOf(shape: Shape): number {
  let h = 0x12345678;
  for (let i = 0; i < shape.id.length; i++) {
    h = (Math.imul(h ^ shape.id.charCodeAt(i), 0x9e3779b9)) >>> 0;
  }
  return h;
}

/**
 * Add a quadratic-bezier "sketchy" segment to the current open path.
 * Caller must call ctx.beginPath() before and ctx.stroke() after collecting all segments.
 */
function sketchSegment(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  rand: () => number,
): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = len > 0.1 ? -dy / len : 0;
  const ny = len > 0.1 ? dx / len : 0;
  const r = () => rand() - 0.5;
  const mag = Math.min(3, len * 0.015 + 1);
  const cpx = (x1 + x2) / 2 + nx * r() * mag * 2 + r() * mag;
  const cpy = (y1 + y2) / 2 + ny * r() * mag * 2 + r() * mag;
  ctx.moveTo(x1 + r() * 1.2, y1 + r() * 1.2);
  ctx.quadraticCurveTo(cpx, cpy, x2 + r() * 1.2, y2 + r() * 1.2);
}

/** Draw the 4 sides of a rectangle with a hand-drawn sketchy stroke (fill is unaffected) */
function drawSketchyRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  rand: () => number,
): void {
  const ov = () => (rand() - 0.5) * 2.5;
  ctx.beginPath();
  sketchSegment(ctx, x + ov(), y + ov(), x + w + ov(), y + ov(), rand);          // top
  sketchSegment(ctx, x + w + ov(), y + ov(), x + w + ov(), y + h + ov(), rand);  // right
  sketchSegment(ctx, x + w + ov(), y + h + ov(), x + ov(), y + h + ov(), rand);  // bottom
  sketchSegment(ctx, x + ov(), y + h + ov(), x + ov(), y + ov(), rand);          // left
  ctx.stroke();
}

/** Draw an ellipse with a hand-drawn sketchy stroke (fill is unaffected) */
function drawSketchyEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rx: number, ry: number,
  rand: () => number,
): void {
  const segs = Math.max(20, Math.round(Math.PI * (rx + ry) * 0.5));
  const tStart = (rand() - 0.5) * 0.3;
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const t = tStart + (i / segs) * (Math.PI * 2 + 0.12);
    const wobble = 1 + (rand() - 0.5) * 0.05;
    const px = cx + Math.cos(t) * rx * wobble;
    const py = cy + Math.sin(t) * ry * wobble;
    if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
  }
  ctx.stroke();
}

function hasVisibleStroke(shape: Shape): boolean {
  return shape.lineWidth > 0 && shape.stroke !== "none" && shape.stroke !== "transparent";
}

// ── Pencil-drawing helpers ───────────────────────────────────────
// Pencil style draws multiple thin, slightly offset passes to mimic
// a graphite pencil on paper. Each pass has subtle position jitter.

function pencilSegment(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  rand: () => number,
): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(4, Math.round(len / 6));
  ctx.moveTo(x1 + (rand() - 0.5) * 0.8, y1 + (rand() - 0.5) * 0.8);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x1 + dx * t + (rand() - 0.5) * 1.2;
    const py = y1 + dy * t + (rand() - 0.5) * 1.2;
    ctx.lineTo(px, py);
  }
}

function drawPencilRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  rand: () => number,
): void {
  const savedAlpha = ctx.globalAlpha;
  const passes = 3;
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = savedAlpha * (0.3 + p * 0.15);
    const ov = () => (rand() - 0.5) * 1.5;
    ctx.beginPath();
    pencilSegment(ctx, x + ov(), y + ov(), x + w + ov(), y + ov(), rand);
    pencilSegment(ctx, x + w + ov(), y + ov(), x + w + ov(), y + h + ov(), rand);
    pencilSegment(ctx, x + w + ov(), y + h + ov(), x + ov(), y + h + ov(), rand);
    pencilSegment(ctx, x + ov(), y + h + ov(), x + ov(), y + ov(), rand);
    ctx.stroke();
  }
  ctx.globalAlpha = savedAlpha;
}

function drawPencilEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rx: number, ry: number,
  rand: () => number,
): void {
  const savedAlpha = ctx.globalAlpha;
  const passes = 3;
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = savedAlpha * (0.3 + p * 0.15);
    const segs = Math.max(24, Math.round(Math.PI * (rx + ry) * 0.6));
    const tStart = (rand() - 0.5) * 0.2;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const t = tStart + (i / segs) * (Math.PI * 2 + 0.08);
      const wobble = 1 + (rand() - 0.5) * 0.03;
      const px = cx + Math.cos(t) * rx * wobble + (rand() - 0.5) * 0.8;
      const py = cy + Math.sin(t) * ry * wobble + (rand() - 0.5) * 0.8;
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = savedAlpha;
}

function drawPencilArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  rand: () => number,
): void {
  const headLen = 12;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const savedAlpha = ctx.globalAlpha;

  // Multi-pass shaft
  for (let p = 0; p < 3; p++) {
    ctx.globalAlpha = savedAlpha * (0.3 + p * 0.15);
    ctx.beginPath();
    pencilSegment(ctx, x1, y1, x2, y2, rand);
    ctx.stroke();
  }
  ctx.globalAlpha = savedAlpha;

  // Arrowhead
  const r = () => (rand() - 0.5) * 1.0;
  ctx.beginPath();
  ctx.moveTo(x2 + r(), y2 + r());
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6) + r(),
    y2 - headLen * Math.sin(angle - Math.PI / 6) + r(),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6) + r(),
    y2 - headLen * Math.sin(angle + Math.PI / 6) + r(),
  );
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

/** Render all shapes onto a canvas 2D context */
export function renderShapes(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  preview: Shape | undefined,
  selectedIds: Set<string>,
  rubberBand?: RubberBand,
  style: "plain" | "sketch" | "pencil" = "plain",
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
    drawShape(ctx, shape, style);
    if (selectedIds.has(shape.id)) {
      drawSelectionIndicator(ctx, shape);
    }
  }

  // Draw preview (semi-transparent)
  if (preview) {
    ctx.globalAlpha = 0.5;
    drawShape(ctx, preview, style);
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

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, style: "plain" | "sketch" | "pencil" = "plain"): void {
  const drawStroke = hasVisibleStroke(shape);
  const useSketchy = style === "sketch" || style === "pencil";
  if (drawStroke) {
    ctx.strokeStyle = shape.stroke;
  }
  ctx.fillStyle = shape.fill;
  ctx.lineWidth = drawStroke ? shape.lineWidth : 0;

  // pencil style: thin line, slight transparency, multi-pass
  if (style === "pencil" && drawStroke) {
    ctx.lineWidth = Math.max(0.5, shape.lineWidth * 0.5);
  }

  switch (shape.type) {
    case "rect": {
      const s = shape as RectShape;
      const radius = Math.max(0, Math.min(s.cornerRadius ?? 0, Math.min(s.width, s.height) / 2));
      if (radius > 0) {
        drawRoundedRectPath(ctx, s.x, s.y, s.width, s.height, radius);
        if (s.fill !== "none" && s.fill !== "transparent") {
          ctx.fill();
        }
        if (drawStroke) {
          ctx.stroke();
        }
      } else {
        if (s.fill !== "none" && s.fill !== "transparent") {
          ctx.fillRect(s.x, s.y, s.width, s.height);
        }
        if (drawStroke) {
          if (style === "pencil") {
            drawPencilRect(ctx, s.x, s.y, s.width, s.height, makeRand(seedOf(s)));
          } else if (style === "sketch") {
            drawSketchyRect(ctx, s.x, s.y, s.width, s.height, makeRand(seedOf(s)));
          } else {
            ctx.strokeRect(s.x, s.y, s.width, s.height);
          }
        }
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
        if (style === "pencil") {
          drawPencilEllipse(ctx, s.cx, s.cy, Math.max(s.rx, 0), Math.max(s.ry, 0), makeRand(seedOf(s)));
        } else if (style === "sketch") {
          drawSketchyEllipse(ctx, s.cx, s.cy, Math.max(s.rx, 0), Math.max(s.ry, 0), makeRand(seedOf(s)));
        } else {
          ctx.stroke();
        }
      }
      drawShapeLabel(ctx, s, s.cx, s.cy);
      break;
    }

    case "arrow": {
      const s = shape as ArrowShape;
      if (style === "pencil") {
        drawPencilArrow(ctx, s.x1, s.y1, s.x2, s.y2, makeRand(seedOf(s)));
      } else if (style === "sketch") {
        drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, makeRand(seedOf(s)));
      } else {
        drawArrowStraight(ctx, s.x1, s.y1, s.x2, s.y2);
      }
      drawShapeLabel(ctx, s, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2 - 10);
      break;
    }

    case "bubble": {
      const s = shape as BubbleShape;
      if (useSketchy) {
        drawBubble(ctx, s, makeRand(seedOf(s)));
      } else {
        drawBubbleStraight(ctx, s);
      }
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

function drawBubble(ctx: CanvasRenderingContext2D, shape: BubbleShape, rand: () => number): void {
  const drawStroke = hasVisibleStroke(shape);
  const radius = 10;
  const x = shape.x;
  const y = shape.y;
  const w = shape.width;
  const h = shape.height;
  const wb = () => (rand() - 0.5) * 2;

  ctx.beginPath();
  ctx.moveTo(x + radius + wb(), y + wb());
  ctx.lineTo(x + w - radius + wb(), y + wb());
  ctx.quadraticCurveTo(x + w + wb(), y + wb(), x + w + wb(), y + radius + wb());
  ctx.lineTo(x + w + wb(), y + h - radius + wb());
  ctx.quadraticCurveTo(x + w + wb(), y + h + wb(), x + w - radius + wb(), y + h + wb());
  ctx.lineTo(x + w * 0.6 + wb(), y + h + wb());
  ctx.lineTo(x + w * 0.5 + wb(), y + h + 16 + wb());
  ctx.lineTo(x + w * 0.45 + wb(), y + h + wb());
  ctx.lineTo(x + radius + wb(), y + h + wb());
  ctx.quadraticCurveTo(x + wb(), y + h + wb(), x + wb(), y + h - radius + wb());
  ctx.lineTo(x + wb(), y + radius + wb());
  ctx.quadraticCurveTo(x + wb(), y + wb(), x + radius + wb(), y + wb());
  ctx.closePath();

  if (shape.fill !== "none" && shape.fill !== "transparent") {
    ctx.fill();
  }
  if (drawStroke) {
    ctx.stroke();
  }
}

function drawBubbleStraight(ctx: CanvasRenderingContext2D, shape: BubbleShape): void {
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
  shape: Shape & {
    label?: string;
    labelFontSize?: number;
    labelFontFamily?: string;
    labelFontColor?: string;
    labelAlignH?: "left" | "center" | "right";
    labelAlignV?: "top" | "middle" | "bottom";
    stroke: string;
  },
  defaultX: number,
  defaultY: number,
): void {
  if (!shape.label) { return; }
  ctx.save();
  const fontSize = shape.labelFontSize ?? shapeDefaults.fontSize;
  const hAlign = shape.labelAlignH ?? "center";
  const vAlign = shape.labelAlignV ?? "middle";
  const bounds = shape.getBounds();
  const pad = 8;
  let x = defaultX;
  let y = defaultY;
  if (hAlign === "left") {
    x = bounds.minX + pad;
  } else if (hAlign === "right") {
    x = bounds.maxX - pad;
  }
  if (vAlign === "top") {
    y = bounds.minY + pad + fontSize / 2;
  } else if (vAlign === "bottom") {
    y = bounds.maxY - pad - fontSize / 2;
  }

  ctx.font = `${fontSize}px ${shape.labelFontFamily ?? shapeDefaults.fontFamily}`;
  ctx.fillStyle = shape.labelFontColor ?? shape.stroke;
  ctx.textAlign = hAlign === "left" ? "left" : hAlign === "right" ? "right" : "center";
  ctx.textBaseline = "middle";
  const lines = shape.label.split("\n");
  const lineHeight = fontSize * 1.4;
  const startY = y - (lines.length - 1) * lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, startY + i * lineHeight);
  }
  ctx.restore();
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  rand: () => number,
): void {
  const headLen = 12;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const r = () => rand() - 0.5;

  // Sketchy shaft
  ctx.beginPath();
  sketchSegment(ctx, x1, y1, x2, y2, rand);
  ctx.stroke();

  // Arrowhead (with slight wobble)
  ctx.beginPath();
  ctx.moveTo(x2 + r() * 1.0, y2 + r() * 1.0);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6) + r() * 1.5,
    y2 - headLen * Math.sin(angle - Math.PI / 6) + r() * 1.5,
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6) + r() * 1.5,
    y2 - headLen * Math.sin(angle + Math.PI / 6) + r() * 1.5,
  );
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

function drawArrowStraight(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
): void {
  const headLen = 12;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
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
  // Rect, Ellipse, Bubble show only TL/BR handles
  const tlBrOnly = shape instanceof RectShape || shape instanceof EllipseShape || shape instanceof BubbleShape;
  const corners = tlBrOnly ? [h.tl, h.br] : [h.tl, h.tr, h.bl, h.br];
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

// ── Shape boundary helpers ───────────────────────────────────────

/**
 * Get the center point of a shape.
 */
export function getShapeCenter(shape: Shape): Point {
  const bounds = shape.getBounds();
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/**
 * Calculate the intersection point where a line segment (from → to)
 * crosses the boundary of the given shape.
 * Returns the intersection closest to 'from'.
 */
export function getShapeBoundaryPoint(shape: Shape, from: Point, to: Point): Point {
  if (shape instanceof EllipseShape) {
    return getEllipseBoundaryPoint(shape, from, to);
  }
  // For all other shapes (Rect, Bubble, Table, Text, Image), treat as rectangle
  return getRectBoundaryPoint(shape, from, to);
}

/**
 * Calculate intersection of line segment (from → to) with the boundary
 * of a rectangle shape.
 */
function getRectBoundaryPoint(shape: Shape, from: Point, to: Point): Point {
  const bounds = shape.getBounds();
  const { minX, maxX, minY, maxY } = bounds;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    // Degenerate case: from and to are the same point
    return from;
  }

  // Test intersection with all four edges
  const intersections: Point[] = [];

  // Top edge (y = minY)
  if (dy !== 0) {
    const t = (minY - from.y) / dy;
    if (t >= 0 && t <= 1) {
      const x = from.x + t * dx;
      if (x >= minX && x <= maxX) {
        intersections.push({ x, y: minY });
      }
    }
  }

  // Bottom edge (y = maxY)
  if (dy !== 0) {
    const t = (maxY - from.y) / dy;
    if (t >= 0 && t <= 1) {
      const x = from.x + t * dx;
      if (x >= minX && x <= maxX) {
        intersections.push({ x, y: maxY });
      }
    }
  }

  // Left edge (x = minX)
  if (dx !== 0) {
    const t = (minX - from.x) / dx;
    if (t >= 0 && t <= 1) {
      const y = from.y + t * dy;
      if (y >= minY && y <= maxY) {
        intersections.push({ x: minX, y });
      }
    }
  }

  // Right edge (x = maxX)
  if (dx !== 0) {
    const t = (maxX - from.x) / dx;
    if (t >= 0 && t <= 1) {
      const y = from.y + t * dy;
      if (y >= minY && y <= maxY) {
        intersections.push({ x: maxX, y });
      }
    }
  }

  // Return the intersection closest to 'from'
  if (intersections.length === 0) {
    // Fallback to shape center if no intersection found
    const center = getShapeCenter(shape);
    return center;
  }

  let closest = intersections[0];
  let minDist = Math.hypot(closest.x - from.x, closest.y - from.y);
  for (let i = 1; i < intersections.length; i++) {
    const dist = Math.hypot(intersections[i].x - from.x, intersections[i].y - from.y);
    if (dist < minDist) {
      minDist = dist;
      closest = intersections[i];
    }
  }
  return closest;
}

/**
 * Calculate intersection of line segment (from → to) with the boundary
 * of an ellipse shape.
 */
function getEllipseBoundaryPoint(shape: EllipseShape, from: Point, to: Point): Point {
  const { cx, cy, rx, ry } = shape;
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return from;
  }

  // Normalize the line to unit circle space
  // Ellipse equation: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 = 1
  // Line parametric: x = from.x + t*dx, y = from.y + t*dy
  // Substitute and solve quadratic for t

  const fx = (from.x - cx) / rx;
  const fy = (from.y - cy) / ry;
  const ddx = dx / rx;
  const ddy = dy / ry;

  const a = ddx * ddx + ddy * ddy;
  const b = 2 * (fx * ddx + fy * ddy);
  const c = fx * fx + fy * fy - 1;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    // No intersection, return center
    return { x: cx, y: cy };
  }

  const sqrt_d = Math.sqrt(discriminant);
  const t1 = (-b - sqrt_d) / (2 * a);
  const t2 = (-b + sqrt_d) / (2 * a);

  // Find the intersection closest to 'from' that lies on the segment [0, 1]
  const candidates: Point[] = [];
  for (const t of [t1, t2]) {
    if (t >= 0 && t <= 1) {
      candidates.push({
        x: from.x + t * dx,
        y: from.y + t * dy,
      });
    }
  }

  if (candidates.length === 0) {
    // Fallback to center
    return { x: cx, y: cy };
  }

  let closest = candidates[0];
  let minDist = Math.hypot(closest.x - from.x, closest.y - from.y);
  for (let i = 1; i < candidates.length; i++) {
    const dist = Math.hypot(candidates[i].x - from.x, candidates[i].y - from.y);
    if (dist < minDist) {
      minDist = dist;
      closest = candidates[i];
    }
  }
  return closest;
}
