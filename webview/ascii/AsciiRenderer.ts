import { AsciiBuffer, getDisplayWidth, isFullWidth, type CursorPos, type SelectionRange } from "./AsciiBuffer";

export interface RenderMetrics {
  cellWidth: number;
  cellHeight: number;
  gutterWidth: number;
}

export class AsciiRenderer {
  private readonly fontSize: number;
  private readonly fontFamily: string;
  private cursorVisible = true;
  private metricsCache: RenderMetrics | null = null;

  constructor(fontSize = 16, fontFamily = "Consolas, 'Courier New', monospace") {
    this.fontSize = fontSize;
    this.fontFamily = fontFamily;
    window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
    }, 530);
  }

  public getMetrics(ctx: CanvasRenderingContext2D): RenderMetrics {
    if (this.metricsCache) {
      return this.metricsCache;
    }
    ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    const measure = ctx.measureText("M");
    const cellWidth = Math.ceil(measure.width || this.fontSize * 0.65);
    const cellHeight = Math.ceil(this.fontSize * 1.5);
    this.metricsCache = { cellWidth, cellHeight, gutterWidth: cellWidth * 4 };
    return this.metricsCache;
  }

  public resizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, buffer: AsciiBuffer): RenderMetrics {
    const metrics = this.getMetrics(ctx);
    const dpr = window.devicePixelRatio || 1;
    const width = metrics.gutterWidth + buffer.width * metrics.cellWidth + metrics.cellWidth * 2;
    const height = buffer.height * metrics.cellHeight + metrics.cellHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = "top";
    return metrics;
  }

  public render(ctx: CanvasRenderingContext2D, buffer: AsciiBuffer, cursor: CursorPos, selection: SelectionRange | null): RenderMetrics {
    const metrics = this.resizeCanvas(ctx.canvas, ctx, buffer);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--vscode-editor-background") || "#1e1e1e";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const normalized = buffer.getNormalizedSelection(selection);
    if (normalized) {
      ctx.fillStyle = "rgba(100, 149, 237, 0.28)";
      for (let row = normalized.top; row <= normalized.bottom; row += 1) {
        const x = metrics.gutterWidth + normalized.left * metrics.cellWidth;
        const y = row * metrics.cellHeight;
        const width = (normalized.right - normalized.left + 1) * metrics.cellWidth;
        ctx.fillRect(x, y, width, metrics.cellHeight);
      }
    }

    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--vscode-editor-foreground") || "#d4d4d4";
    for (let row = 0; row < buffer.height; row += 1) {
      const y = row * metrics.cellHeight;
      ctx.fillStyle = "rgba(128, 128, 128, 0.75)";
      ctx.fillText(String(row + 1).padStart(3, " "), 0, y);
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--vscode-editor-foreground") || "#d4d4d4";
      let colOffset = 0;
      for (const char of [...buffer.getLine(row)]) {
        const x = metrics.gutterWidth + colOffset * metrics.cellWidth;
        ctx.fillText(char, x, y);
        colOffset += isFullWidth(char) ? 2 : 1;
      }
    }

    if (this.cursorVisible) {
      const x = metrics.gutterWidth + cursor.col * metrics.cellWidth;
      const y = cursor.row * metrics.cellHeight;
      const width = Math.max(metrics.cellWidth, metrics.cellWidth * (buffer.getCell(cursor.row, cursor.col) && isFullWidth(buffer.getCell(cursor.row, cursor.col)) ? 2 : 1));
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fillRect(x, y, width, metrics.cellHeight);
      const char = buffer.getCell(cursor.row, cursor.col);
      if (char && char.trim() !== "") {
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--vscode-editor-foreground") || "#d4d4d4";
        ctx.fillText(char, x, y);
      }
    }

    return metrics;
  }

  public screenToCell(x: number, y: number, metrics: RenderMetrics): CursorPos {
    return {
      row: Math.max(0, Math.floor(y / metrics.cellHeight)),
      col: Math.max(0, Math.floor((x - metrics.gutterWidth) / metrics.cellWidth)),
    };
  }
}
