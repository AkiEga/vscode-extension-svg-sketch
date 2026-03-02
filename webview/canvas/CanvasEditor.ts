import type { Shape, ToolType, DrawStyle, Point, Tool } from "../shared";
import { hitTest, TextShape, TableShape, RectShape, EllipseShape, ArrowShape, BubbleShape, ImageShape, nextId } from "../shared";
import { RectTool } from "./tools/RectTool";
import { EllipseTool } from "./tools/EllipseTool";
import { ArrowTool } from "./tools/ArrowTool";
import { BubbleTool } from "./tools/BubbleTool";
import { TextTool } from "./tools/TextTool";
import { TableTool, type TableConfigRequest } from "./tools/TableTool";
import { SelectTool } from "./tools/SelectTool";
import { renderShapes } from "./render";
import { prepareTemplateInsertion } from "./templateInsert";
import { DEFAULT_DRAW_STYLE } from "./drawStyle";

/** Snap a value to the nearest grid line */
function snapValue(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export class CanvasEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shapes: Shape[] = [];
  private currentToolType: ToolType = "select";
  private currentTool: Tool;
  private style: DrawStyle = { ...DEFAULT_DRAW_STYLE };
  private isDragging = false;
  private selectedIds: Set<string> = new Set();
  private selectTool: SelectTool;

  // Undo/Redo
  private undoStack: Shape[][] = [];
  private redoStack: Shape[][] = [];

  // Copy/Paste clipboard
  private clipboard: Shape[] = [];

  // Grid snap
  private _snapToGrid = true;
  private _gridSize = 20;

  private onSelectionChange: (ids: Set<string>) => void = () => {};
  private onChange: () => void = () => {};
  private onToolChange: (tool: ToolType) => void = () => {};
  private activePopupCleanup: (() => void) | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.selectTool = new SelectTool(this.shapes, (ids) => {
      this.selectedIds = new Set(ids);
      this.onSelectionChange(new Set(ids));
    }, () => this.pushUndo());
    this.currentTool = this.selectTool;
    this.canvas.className = "tool-select";
    this.setupEvents();
    this.resize();
    this.render();
  }

  setTool(toolType: ToolType): void {
    // Cancel any open popup (text input / table config) before switching
    if (this.activePopupCleanup) {
      this.activePopupCleanup();
      this.activePopupCleanup = undefined;
    }
    this.currentToolType = toolType;
    switch (toolType) {
      case "rect":
        this.currentTool = new RectTool();
        break;
      case "ellipse":
        this.currentTool = new EllipseTool();
        break;
      case "arrow":
        this.currentTool = new ArrowTool();
        break;
      case "bubble":
        this.currentTool = new BubbleTool();
        break;
      case "text": {
        const textTool = new TextTool();
        textTool.onTextRequest = (req) => this.showTextInput(req.pt, req.style);
        this.currentTool = textTool;
        break;
      }
      case "table": {
        const tableTool = new TableTool();
        tableTool.onTableRequest = (req) => this.showTableConfig(req);
        this.currentTool = tableTool;
        break;
      }
      case "select":
        this.currentTool = this.selectTool;
        break;
    }
    this.canvas.className = toolType === "select" ? "tool-select" : "";
    if (toolType !== "select") {
      this.canvas.style.cursor = "";
    }
  }

  setStyle(style: Partial<DrawStyle>): void {
    Object.assign(this.style, style);
    // Apply style changes to currently selected shapes
    if (this.selectedIds.size > 0) {
      const targets = this.shapes.filter((s) => this.selectedIds.has(s.id));
      if (targets.length > 0) {
        this.pushUndo();
        for (const shape of targets) {
          if (style.stroke !== undefined) { shape.stroke = style.stroke; }
          if (style.fill !== undefined) { shape.fill = style.fill; }
          if (style.lineWidth !== undefined) { shape.lineWidth = style.lineWidth; }
          // Apply font properties to text-bearing shapes
          if (shape instanceof TextShape) {
            if (style.fontSize !== undefined) { shape.fontSize = style.fontSize; }
            if (style.fontFamily !== undefined) { shape.fontFamily = style.fontFamily; }
            if (style.fontColor !== undefined) { shape.fontColor = style.fontColor; }
          }
          if (shape instanceof TableShape) {
            if (style.fontSize !== undefined) { shape.fontSize = style.fontSize; }
            if (style.fontFamily !== undefined) { shape.fontFamily = style.fontFamily; }
            if (style.fontColor !== undefined) { shape.fontColor = style.fontColor; }
          }
          if (shape instanceof RectShape || shape instanceof EllipseShape || shape instanceof ArrowShape || shape instanceof BubbleShape) {
            if (style.fontSize !== undefined) { shape.labelFontSize = style.fontSize; }
            if (style.fontFamily !== undefined) { shape.labelFontFamily = style.fontFamily; }
            if (style.fontColor !== undefined) { shape.labelFontColor = style.fontColor; }
          }
        }
        this.onChange();
        this.render();
      }
    }
  }

  /** Update current drawing style only (does not modify existing shapes). */
  setCurrentStyle(style: Partial<DrawStyle>): void {
    Object.assign(this.style, style);
  }

  getCurrentStyle(): DrawStyle {
    return { ...this.style };
  }

  setOnSelectionChange(cb: (ids: Set<string>) => void): void {
    this.onSelectionChange = cb;
  }

  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  setOnToolChange(cb: (tool: ToolType) => void): void {
    this.onToolChange = cb;
  }

  getShapes(): Shape[] {
    return [...this.shapes];
  }

  setShapes(shapes: Shape[]): void {
    this.shapes.length = 0;
    this.shapes.push(...shapes);
    this.selectTool = new SelectTool(this.shapes, (ids) => {
      this.selectedIds = new Set(ids);
      this.onSelectionChange(new Set(ids));
    }, () => this.pushUndo());
    if (this.currentToolType === "select") {
      this.currentTool = this.selectTool;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  insertShapes(incomingShapes: Shape[]): string[] {
    const prepared = prepareTemplateInsertion(this.shapes, incomingShapes);
    if (prepared.shapes.length === 0) {
      return [];
    }

    this.pushUndo();
    this.shapes.push(...prepared.shapes);
    const insertedIds = prepared.insertedIds;
    this.selectedIds = new Set(insertedIds);
    this.onSelectionChange(new Set(this.selectedIds));
    this.onChange();
    this.render();
    return insertedIds;
  }

  deleteSelected(): void {
    if (this.selectedIds.size === 0) { return; }
    this.pushUndo();
    const idsToDelete = new Set(this.selectedIds);
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      if (idsToDelete.has(this.shapes[i].id)) {
        this.shapes.splice(i, 1);
      }
    }
    this.selectedIds.clear();
    this.onSelectionChange(new Set());
    this.onChange();
    this.render();
  }

  // --- Copy/Paste ---

  copySelected(): void {
    if (this.selectedIds.size === 0) { return; }
    this.clipboard = this.shapes
      .filter((s) => this.selectedIds.has(s.id))
      .map((s) => s.clone());
  }

  paste(): void {
    if (this.clipboard.length === 0) { return; }
    this.pushUndo();
    const pasteOffset = 20;
    const newIds: string[] = [];
    for (const original of this.clipboard) {
      const id = nextId();
      const copy = original.clone(id).translate(pasteOffset, pasteOffset);
      this.shapes.push(copy);
      newIds.push(id);
    }
    // Update clipboard so next paste offsets further
    this.clipboard = this.clipboard.map((s) => s.translate(pasteOffset, pasteOffset));
    this.selectedIds = new Set(newIds);
    this.onSelectionChange(new Set(this.selectedIds));
    this.onChange();
    this.render();
  }

  // --- Grid snap ---

  get snapToGrid(): boolean { return this._snapToGrid; }
  set snapToGrid(v: boolean) { this._snapToGrid = v; }

  get gridSize(): number { return this._gridSize; }
  set gridSize(v: number) { this._gridSize = Math.max(1, v); }

  toggleSnap(): boolean {
    this._snapToGrid = !this._snapToGrid;
    return this._snapToGrid;
  }

  undo(): void {
    if (this.undoStack.length === 0) { return; }
    this.redoStack.push(this.cloneShapes());
    const prev = this.undoStack.pop()!;
    this.shapes.length = 0;
    this.shapes.push(...prev);
    this.onChange();
    this.render();
  }

  redo(): void {
    if (this.redoStack.length === 0) { return; }
    this.undoStack.push(this.cloneShapes());
    const next = this.redoStack.pop()!;
    this.shapes.length = 0;
    this.shapes.push(...next);
    this.onChange();
    this.render();
  }

  getCanvasSize(): { width: number; height: number } {
    const dpr = window.devicePixelRatio || 1;
    return { width: this.canvas.width / dpr, height: this.canvas.height / dpr };
  }

  private pushUndo(): void {
    this.undoStack.push(this.cloneShapes());
    this.redoStack = [];
  }

  private cloneShapes(): Shape[] {
    return this.shapes.map(s => s.clone());
  }

  private snapSelectedShapesToGrid(): void {
    for (const shape of this.shapes) {
      if (this.selectedIds.has(shape.id)) {
        this.snapShapeToGrid(shape);
      }
    }
  }

  private snapShapeToGrid(shape: Shape): void {
    const gs = this._gridSize;
    const minDiameter = gs;
    const minRadius = Math.max(1, gs / 2);

    if (shape instanceof RectShape || shape instanceof BubbleShape || shape instanceof TableShape || shape instanceof ImageShape) {
      shape.x = snapValue(shape.x, gs);
      shape.y = snapValue(shape.y, gs);
      shape.width = Math.max(minDiameter, snapValue(shape.width, gs));
      shape.height = Math.max(minDiameter, snapValue(shape.height, gs));
      return;
    }

    if (shape instanceof EllipseShape) {
      shape.cx = snapValue(shape.cx, gs);
      shape.cy = snapValue(shape.cy, gs);
      shape.rx = Math.max(minRadius, snapValue(shape.rx, gs));
      shape.ry = Math.max(minRadius, snapValue(shape.ry, gs));
      return;
    }

    if (shape instanceof ArrowShape) {
      shape.x1 = snapValue(shape.x1, gs);
      shape.y1 = snapValue(shape.y1, gs);
      shape.x2 = snapValue(shape.x2, gs);
      shape.y2 = snapValue(shape.y2, gs);
      return;
    }

    if (shape instanceof TextShape) {
      shape.x = snapValue(shape.x, gs);
      shape.y = snapValue(shape.y, gs);
    }
  }

  private setupEvents(): void {
    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.canvas.addEventListener("mouseup", (e) => this.onMouseUp(e));
    this.canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    this.canvas.addEventListener("contextmenu", (e) => this.onContextMenu(e));

    window.addEventListener("resize", () => {
      this.resize();
      this.render();
    });

    window.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedIds.size > 0) {
        this.deleteSelected();
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        this.undo();
      }
      if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        this.redo();
      }
      if (e.ctrlKey && e.key === "c") {
        e.preventDefault();
        this.copySelected();
      }
      if (e.ctrlKey && e.key === "v") {
        e.preventDefault();
        this.paste();
      }
      if (e.key === "F2") {
        e.preventDefault();
        this.editSelectedShapeLabel();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "g" && !e.shiftKey) {
        e.preventDefault();
        this.groupSelected();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "g" && e.shiftKey) {
        e.preventDefault();
        this.ungroupSelected();
      }
    });
  }

  private getPoint(e: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Tool input point: drawing tools are snapped, select tool uses raw coordinates. */
  private getToolPoint(e: MouseEvent): Point {
    const pt = this.getPoint(e);
    if (!this._snapToGrid || this.currentToolType === "select") {
      return pt;
    }
    return {
      x: snapValue(pt.x, this._gridSize),
      y: snapValue(pt.y, this._gridSize),
    };
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) { return; } // Only handle left button
    this.isDragging = true;
    this.currentTool.onMouseDown(this.getToolPoint(e), this.style, { shiftKey: e.shiftKey });
    this.render();
  }

  private onMouseMove(e: MouseEvent): void {
    // Update cursor based on handle hover (even when not dragging)
    if (this.currentToolType === "select" && !this.isDragging) {
      const cursor = this.selectTool.getCursorAt(this.getPoint(e));
      this.canvas.style.cursor = cursor ?? "default";
    }
    if (!this.isDragging) { return; }
    this.currentTool.onMouseMove(this.getToolPoint(e));
    if (this._snapToGrid && this.currentToolType === "select") {
      this.snapSelectedShapesToGrid();
    }
    this.render();
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.isDragging) { return; }
    this.isDragging = false;
    const wasDraggingSelect = this.currentToolType === "select";
    const shape = this.currentTool.onMouseUp(this.getToolPoint(e));
    if (shape) {
      if (this._snapToGrid) {
        this.snapShapeToGrid(shape);
      }
      this.pushUndo();
      this.shapes.push(shape);
      this.onChange();
      this.switchToSelect();
    } else if (wasDraggingSelect && this.selectedIds.size > 0) {
      if (this._snapToGrid) {
        this.snapSelectedShapesToGrid();
      }
      // Notify change after move / resize (undo was pushed by SelectTool)
      this.onChange();
    }
    this.render();
  }

  resize(): void {
    const container = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  render(): void {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const preview = this.currentTool.getPreview();
    const rubberBand = this.selectTool.getRubberband();
    renderShapes(this.ctx, this.shapes, preview, this.selectedIds, rubberBand);
  }

  private showTextInput(pt: Point, style: DrawStyle): void {
    const container = this.canvas.parentElement!;
    const rect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const input = document.createElement("input");
    input.type = "text";
    input.style.position = "absolute";
    input.style.left = `${rect.left - contRect.left + pt.x}px`;
    input.style.top = `${rect.top - contRect.top + pt.y - style.fontSize}px`;
    input.style.fontSize = `${style.fontSize}px`;
    input.style.fontFamily = style.fontFamily;
    input.style.border = "1px solid #007acc";
    input.style.outline = "none";
    input.style.padding = "2px 4px";
    input.style.background = "#fff";
    input.style.color = style.fontColor;
    input.style.minWidth = "80px";
    input.style.zIndex = "10";
    container.appendChild(input);
    input.focus();

    let committed = false;

    const commit = () => {
      if (committed) { return; }
      committed = true;
      const text = input.value.trim();
      if (text) {
        const shape = new TextShape({
          id: nextId(),
          x: pt.x,
          y: pt.y,
          text,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          fontColor: style.fontColor,
          stroke: style.stroke,
          fill: style.stroke,
          lineWidth: style.lineWidth,
        });
        this.pushUndo();
        this.shapes.push(shape);
        this.onChange();
        this.switchToSelect();
        this.render();
      }
      cleanup();
    };

    const cleanup = () => {
      this.activePopupCleanup = undefined;
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("blur", onBlur);
      if (input.parentElement) {
        input.parentElement.removeChild(input);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        cleanup();
      }
    };

    const onBlur = () => {
      commit();
    };

    input.addEventListener("keydown", onKey);
    input.addEventListener("blur", onBlur);

    // Register so setTool() can cancel without committing
    this.activePopupCleanup = cleanup;
  }

  editSelectedShapeLabel(): void {
    const shape = this.getSelectedShape();
    if (!shape) { return; }
    if (shape instanceof TableShape) {
      this.editTableCell(shape, { x: shape.x + 1, y: shape.y + 1 });
      return;
    }
    if (shape instanceof TextShape) {
      this.editTextShape(shape);
      return;
    }
    if (shape instanceof RectShape || shape instanceof EllipseShape || shape instanceof ArrowShape || shape instanceof BubbleShape) {
      this.editShapeLabel(shape);
    }
  }

  private editShapeLabel(shape: RectShape | EllipseShape | ArrowShape | BubbleShape): void {
    const b = shape.getBounds();
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const container = this.canvas.parentElement!;
    const canvasRect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const input = document.createElement("input");
    input.type = "text";
    input.value = shape.label ?? "";
    input.placeholder = "Label";
    input.style.position = "absolute";
    input.style.left = `${canvasRect.left - contRect.left + cx - 60}px`;
    input.style.top = `${canvasRect.top - contRect.top + cy - 12}px`;
    input.style.width = "120px";
    input.style.fontSize = `${shape.labelFontSize ?? this.style.fontSize}px`;
    input.style.fontFamily = shape.labelFontFamily ?? this.style.fontFamily;
    input.style.border = "1px solid #007acc";
    input.style.outline = "none";
    input.style.padding = "2px 4px";
    input.style.background = "#fff";
    input.style.color = shape.labelFontColor ?? shape.stroke;
    input.style.zIndex = "10";
    container.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = () => {
      if (committed) { return; }
      committed = true;
      const text = input.value.trim();
      const nextLabel = text || undefined;
      if (nextLabel !== shape.label) {
        this.pushUndo();
        shape.label = nextLabel;
        shape.labelFontSize = shape.labelFontSize ?? this.style.fontSize;
        shape.labelFontFamily = shape.labelFontFamily ?? this.style.fontFamily;
        shape.labelFontColor = shape.labelFontColor ?? this.style.fontColor;
        this.onChange();
        this.render();
      }
      cleanup();
    };

    const cleanup = () => {
      this.activePopupCleanup = undefined;
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("blur", onBlur);
      if (input.parentElement) {
        input.parentElement.removeChild(input);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        cleanup();
      }
    };
    const onBlur = () => { commit(); };

    input.addEventListener("keydown", onKey);
    input.addEventListener("blur", onBlur);
    this.activePopupCleanup = cleanup;
  }

  private showTableConfig(req: TableConfigRequest): void {
    const container = this.canvas.parentElement!;
    const rect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const panel = document.createElement("div");
    panel.style.position = "absolute";
    panel.style.left = `${rect.left - contRect.left + req.pt.x}px`;
    panel.style.top = `${rect.top - contRect.top + req.pt.y}px`;
    panel.style.background = "var(--vscode-editorWidget-background, #fff)";
    panel.style.border = "1px solid var(--vscode-widget-border, #007acc)";
    panel.style.borderRadius = "4px";
    panel.style.padding = "8px";
    panel.style.zIndex = "10";
    panel.style.display = "flex";
    panel.style.gap = "6px";
    panel.style.alignItems = "center";
    panel.style.fontSize = "12px";
    panel.style.color = "var(--vscode-editor-foreground, #000)";

    const rowsInput = document.createElement("input");
    rowsInput.type = "number";
    rowsInput.min = "1";
    rowsInput.max = "50";
    rowsInput.value = "3";
    rowsInput.style.width = "44px";
    rowsInput.style.padding = "2px 4px";
    rowsInput.style.background = "var(--vscode-input-background, #fff)";
    rowsInput.style.color = "var(--vscode-input-foreground, #000)";
    rowsInput.style.border = "1px solid var(--vscode-input-border, #ccc)";

    const colsInput = document.createElement("input");
    colsInput.type = "number";
    colsInput.min = "1";
    colsInput.max = "50";
    colsInput.value = "3";
    colsInput.style.width = "44px";
    colsInput.style.padding = "2px 4px";
    colsInput.style.background = "var(--vscode-input-background, #fff)";
    colsInput.style.color = "var(--vscode-input-foreground, #000)";
    colsInput.style.border = "1px solid var(--vscode-input-border, #ccc)";

    const okBtn = document.createElement("button");
    okBtn.textContent = "OK";
    okBtn.style.padding = "2px 10px";
    okBtn.style.cursor = "pointer";

    const rowLabel = document.createElement("span");
    rowLabel.textContent = "Rows:";
    const colLabel = document.createElement("span");
    colLabel.textContent = "Cols:";

    panel.appendChild(rowLabel);
    panel.appendChild(rowsInput);
    panel.appendChild(colLabel);
    panel.appendChild(colsInput);
    panel.appendChild(okBtn);
    container.appendChild(panel);
    rowsInput.focus();
    rowsInput.select();

    const cleanup = () => {
      this.activePopupCleanup = undefined;
      if (panel.parentElement) {
        panel.parentElement.removeChild(panel);
      }
    };

    const commit = () => {
      const rows = Math.max(1, Math.min(50, parseInt(rowsInput.value, 10) || 3));
      const cols = Math.max(1, Math.min(50, parseInt(colsInput.value, 10) || 3));
      const shape = TableTool.createShape(req.pt, req.width, req.height, req.style, rows, cols);
      if (this._snapToGrid) {
        this.snapShapeToGrid(shape);
      }
      this.pushUndo();
      this.shapes.push(shape);
      this.onChange();
      this.switchToSelect();
      this.render();
      cleanup();
    };

    okBtn.addEventListener("click", () => commit());
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        cleanup();
      }
    });

    // Register so setTool() can cancel without committing
    this.activePopupCleanup = cleanup;
  }

  // --- Table mutation methods ---

  private switchToSelect(): void {
    this.setTool("select");
    this.onToolChange("select");
  }

  getSelectedShape(): Shape | undefined {
    if (this.selectedIds.size !== 1) { return undefined; }
    const id = [...this.selectedIds][0];
    return this.shapes.find((s) => s.id === id);
  }

  getSelectedShapes(): Shape[] {
    return this.shapes.filter((s) => this.selectedIds.has(s.id));
  }

  async insertImageDataUrl(dataUrl: string, maxWidth = 1024): Promise<void> {
    const image = await this.loadImage(dataUrl);
    const ratio = image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 1;
    const width = Math.max(40, Math.min(maxWidth, image.naturalWidth || 320));
    const height = Math.max(40, Math.round(width * ratio));
    const x = Math.max(0, (this.canvas.width - width) / 2);
    const y = Math.max(0, (this.canvas.height - height) / 2);

    const shape = new ImageShape({
      id: nextId(),
      x,
      y,
      width,
      height,
      dataUrl,
      stroke: this.style.stroke,
      fill: "none",
      lineWidth: this.style.lineWidth,
    });

    this.pushUndo();
    this.shapes.push(shape);
    this.selectedIds = new Set([shape.id]);
    this.onSelectionChange(new Set(this.selectedIds));
    this.onChange();
    this.render();
  }

  private loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load pasted image."));
      image.src = dataUrl;
    });
  }

  groupSelected(): void {
    if (this.selectedIds.size < 2) { return; }
    this.pushUndo();
    const groupId = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    for (const shape of this.shapes) {
      if (this.selectedIds.has(shape.id)) {
        shape.groupId = groupId;
      }
    }
    this.onChange();
    this.render();
  }

  ungroupSelected(): void {
    if (this.selectedIds.size === 0) { return; }
    this.pushUndo();
    for (const shape of this.shapes) {
      if (this.selectedIds.has(shape.id)) {
        shape.groupId = undefined;
      }
    }
    this.onChange();
    this.render();
  }

  addTableRow(): void {
    const shape = this.getSelectedShape();
    if (!(shape instanceof TableShape)) { return; }
    this.pushUndo();
    shape.rows += 1;
    shape.cells.push(new Array(shape.cols).fill(""));
    shape.height += shape.height / (shape.rows - 1);
    this.onChange();
    this.render();
  }

  deleteTableRow(): void {
    const shape = this.getSelectedShape();
    if (!(shape instanceof TableShape) || shape.rows <= 1) { return; }
    this.pushUndo();
    const rowH = shape.height / shape.rows;
    shape.rows -= 1;
    shape.cells.pop();
    shape.height -= rowH;
    this.onChange();
    this.render();
  }

  addTableColumn(): void {
    const shape = this.getSelectedShape();
    if (!(shape instanceof TableShape)) { return; }
    this.pushUndo();
    shape.cols += 1;
    for (const row of shape.cells) {
      row.push("");
    }
    shape.width += shape.width / (shape.cols - 1);
    this.onChange();
    this.render();
  }

  deleteTableColumn(): void {
    const shape = this.getSelectedShape();
    if (!(shape instanceof TableShape) || shape.cols <= 1) { return; }
    this.pushUndo();
    const colW = shape.width / shape.cols;
    shape.cols -= 1;
    for (const row of shape.cells) {
      row.pop();
    }
    shape.width -= colW;
    this.onChange();
    this.render();
  }

  private onDoubleClick(e: MouseEvent): void {
    const pt = this.getPoint(e);
    const shape = this.findShapeAt(pt);
    if (!shape) { return; }

    this.selectShape(shape);
    this.openShapeEditor(shape, pt);
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const pt = this.getPoint(e);
    const shape = this.findShapeAt(pt);
    if (!shape) { return; }

    this.selectShape(shape);
    this.showContextMenu(shape, pt, e);
  }

  private selectShape(shape: Shape): void {
    this.selectedIds = new Set([shape.id]);
    this.onSelectionChange(new Set(this.selectedIds));
    if (this.currentToolType !== "select") {
      this.switchToSelect();
    }
    this.render();
  }

  /** Open inline editor appropriate for the shape type */
  private openShapeEditor(shape: Shape, pt: Point): void {
    switch (shape.type) {
      case "rect":
      case "ellipse":
      case "arrow":
      case "bubble":
        this.editShapeLabel(shape as RectShape | EllipseShape | ArrowShape | BubbleShape);
        break;
      case "text":
        this.editTextShape(shape as TextShape);
        break;
      case "table":
        this.editTableCell(shape as TableShape, pt);
        break;
      // rect, ellipse, arrow: no double-click editor — use drag handles
    }
  }

  /** Show a context menu at the given screen position */
  private showContextMenu(shape: Shape, pt: Point, e: MouseEvent): void {
    this.dismissPopup();

    const container = this.canvas.parentElement!;
    const canvasRect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.style.left = `${canvasRect.left - contRect.left + pt.x}px`;
    menu.style.top = `${canvasRect.top - contRect.top + pt.y}px`;

    const items: { label: string; action: () => void }[] = [];

    // Shape-specific edit entry
    switch (shape.type) {
      case "rect":
      case "ellipse":
      case "arrow":
      case "bubble":
        items.push({ label: "Edit Label", action: () => this.editShapeLabel(shape as RectShape | EllipseShape | ArrowShape | BubbleShape) });
        break;
      case "text":
        items.push({ label: "Edit Text", action: () => this.editTextShape(shape as TextShape) });
        break;
      case "table":
        items.push({ label: "Edit Cell", action: () => this.editTableCell(shape as TableShape, pt) });
        break;
      // rect, ellipse, arrow: resized via drag handles — no panel needed
    }

    items.push({ label: "Bring to Front", action: () => this.bringToFront(shape) });
    items.push({ label: "Send to Back", action: () => this.sendToBack(shape) });
    items.push({ label: "Delete", action: () => this.deleteSelected() });

    for (const item of items) {
      const btn = document.createElement("div");
      btn.className = "ctx-menu-item";
      btn.textContent = item.label;
      btn.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        cleanup();
        item.action();
      });
      menu.appendChild(btn);
    }

    container.appendChild(menu);

    const cleanup = () => {
      this.activePopupCleanup = undefined;
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEsc);
      if (menu.parentElement) { menu.parentElement.removeChild(menu); }
    };
    const onOutside = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) { cleanup(); }
    };
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { cleanup(); }
    };
    // Delay listener so the current right-click doesn't immediately close the menu
    requestAnimationFrame(() => {
      window.addEventListener("mousedown", onOutside);
      window.addEventListener("keydown", onEsc);
    });
    this.activePopupCleanup = cleanup;
  }

  private bringToFront(shape: Shape): void {
    const idx = this.shapes.indexOf(shape);
    if (idx < 0 || idx === this.shapes.length - 1) { return; }
    this.pushUndo();
    this.shapes.splice(idx, 1);
    this.shapes.push(shape);
    this.onChange();
    this.render();
  }

  private sendToBack(shape: Shape): void {
    const idx = this.shapes.indexOf(shape);
    if (idx <= 0) { return; }
    this.pushUndo();
    this.shapes.splice(idx, 1);
    this.shapes.unshift(shape);
    this.onChange();
    this.render();
  }

  private dismissPopup(): void {
    if (this.activePopupCleanup) {
      this.activePopupCleanup();
      this.activePopupCleanup = undefined;
    }
  }

  private findShapeAt(pt: Point): Shape | undefined {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      if (hitTest(this.shapes[i], pt)) {
        return this.shapes[i];
      }
    }
    return undefined;
  }

  // --- Text editing ---

  private editTextShape(shape: TextShape): void {
    const container = this.canvas.parentElement!;
    const rect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const input = document.createElement("input");
    input.type = "text";
    input.value = shape.text;
    input.style.position = "absolute";
    input.style.left = `${rect.left - contRect.left + shape.x}px`;
    input.style.top = `${rect.top - contRect.top + shape.y - shape.fontSize}px`;
    input.style.fontSize = `${shape.fontSize}px`;
    input.style.fontFamily = shape.fontFamily ?? "sans-serif";
    input.style.border = "1px solid #007acc";
    input.style.outline = "none";
    input.style.padding = "2px 4px";
    input.style.background = "#fff";
    input.style.color = shape.fontColor ?? shape.stroke;
    input.style.minWidth = "80px";
    input.style.zIndex = "10";
    container.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = () => {
      if (committed) { return; }
      committed = true;
      const text = input.value.trim();
      if (text && text !== shape.text) {
        this.pushUndo();
        shape.text = text;
        this.onChange();
        this.render();
      }
      cleanup();
    };

    const cleanup = () => {
      this.activePopupCleanup = undefined;
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("blur", onBlur);
      if (input.parentElement) {
        input.parentElement.removeChild(input);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        cleanup();
      }
    };

    const onBlur = () => { commit(); };

    input.addEventListener("keydown", onKey);
    input.addEventListener("blur", onBlur);
    this.activePopupCleanup = cleanup;
  }

  private editTableCell(shape: TableShape, pt: Point): void {
    const colW = shape.width / shape.cols;
    const rowH = shape.height / shape.rows;
    const col = Math.floor((pt.x - shape.x) / colW);
    const row = Math.floor((pt.y - shape.y) / rowH);
    if (row < 0 || row >= shape.rows || col < 0 || col >= shape.cols) { return; }

    const container = this.canvas.parentElement!;
    const canvasRect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const cellX = shape.x + col * colW;
    const cellY = shape.y + row * rowH;

    const input = document.createElement("input");
    input.type = "text";
    input.value = shape.cells[row]?.[col] ?? "";
    input.style.position = "absolute";
    input.style.left = `${canvasRect.left - contRect.left + cellX + 1}px`;
    input.style.top = `${canvasRect.top - contRect.top + cellY + 1}px`;
    input.style.width = `${colW - 2}px`;
    input.style.height = `${rowH - 2}px`;
    input.style.fontSize = `${shape.fontSize}px`;
    input.style.fontFamily = "sans-serif";
    input.style.border = "1px solid #007acc";
    input.style.outline = "none";
    input.style.padding = "2px 4px";
    input.style.background = "#fff";
    input.style.color = shape.stroke;
    input.style.zIndex = "10";
    input.style.boxSizing = "border-box";
    container.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = () => {
      if (committed) { return; }
      committed = true;
      const text = input.value;
      if (text !== (shape.cells[row]?.[col] ?? "")) {
        this.pushUndo();
        shape.cells[row][col] = text;
        this.onChange();
        this.render();
      }
      cleanup();
    };

    const cleanup = () => {
      this.activePopupCleanup = undefined;
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("blur", onBlur);
      if (input.parentElement) {
        input.parentElement.removeChild(input);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        cleanup();
      } else if (e.key === "Tab") {
        e.preventDefault();
        commit();
        const nextCol = e.shiftKey ? col - 1 : col + 1;
        if (nextCol >= 0 && nextCol < shape.cols) {
          this.editTableCell(shape, { x: shape.x + nextCol * colW + 1, y: shape.y + row * rowH + 1 });
        } else if (!e.shiftKey && row + 1 < shape.rows) {
          this.editTableCell(shape, { x: shape.x + 1, y: shape.y + (row + 1) * rowH + 1 });
        }
      }
    };

    const onBlur = () => { commit(); };

    input.addEventListener("keydown", onKey);
    input.addEventListener("blur", onBlur);
    this.activePopupCleanup = cleanup;
  }
}
