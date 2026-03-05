import type { Shape, ToolType, DrawStyle, Point, Tool } from "../shared";
import { hitTest, TextShape, TableShape, RectShape, EllipseShape, ArrowShape, ImageShape, nextId } from "../shared";
import { RectTool } from "./tools/RectTool";
import { EllipseTool } from "./tools/EllipseTool";
import { ArrowTool } from "./tools/ArrowTool";
import { TextTool } from "./tools/TextTool";
import { TableTool, type TableConfigRequest } from "./tools/TableTool";
import { SelectTool, getShapeHandles } from "./tools/SelectTool";
import type { DragHandleId } from "./tools/SelectTool";
import { renderShapes, getShapeCenter, getShapeBoundaryPoint } from "./render";
import { prepareTemplateInsertion } from "./templateInsert";
import { DEFAULT_DRAW_STYLE } from "./drawStyle";
import { EditorStateMachine } from "./EditorStateMachine";
import { EdgeEditPanel } from "../ui/EdgeEditPanel";
import { FillStyleEditPanel } from "../ui/FillStyleEditPanel";

/** Snap a value to the nearest grid line */
function snapValue(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * ハンドル (点) を delta 分だけ移動する。
 * 矢印キー / hjkl でのハンドル単体移動に使用。
 */
function applyHandleDelta(shape: Shape, handle: DragHandleId, dx: number, dy: number): void {
  if (shape instanceof ArrowShape) {
    if (handle === "start") { shape.x1 += dx; shape.y1 += dy; }
    else if (handle === "end") { shape.x2 += dx; shape.y2 += dy; }
    return;
  }
  if (shape instanceof EllipseShape) {
    // rx/ry 調整: 動かすハンドルの辺だけ広がり/縮む。対辺は固定。
    const rxSign = (handle === "tr" || handle === "br") ? 1 : -1;
    const rySign = (handle === "bl" || handle === "br") ? 1 : -1;
    shape.cx += dx / 2;
    shape.cy += dy / 2;
    shape.rx = Math.max(5, shape.rx + rxSign * dx / 2);
    shape.ry = Math.max(5, shape.ry + rySign * dy / 2);
    return;
  }
  if (shape instanceof RectShape || shape instanceof TableShape || shape instanceof ImageShape) {
    const s = shape as { x: number; y: number; width: number; height: number };
    const MIN = 10;
    switch (handle) {
      case "tl": {
        const nw = Math.max(MIN, s.width - dx);
        const nh = Math.max(MIN, s.height - dy);
        s.x += s.width - nw; s.y += s.height - nh;
        s.width = nw; s.height = nh; break;
      }
      case "tr": {
        const nh = Math.max(MIN, s.height - dy);
        s.y += s.height - nh;
        s.width = Math.max(MIN, s.width + dx); s.height = nh; break;
      }
      case "bl": {
        const nw = Math.max(MIN, s.width - dx);
        s.x += s.width - nw;
        s.width = nw; s.height = Math.max(MIN, s.height + dy); break;
      }
      case "br":
        s.width = Math.max(MIN, s.width + dx);
        s.height = Math.max(MIN, s.height + dy); break;
    }
  }
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

  // Render style: "plain" | "sketch" | "pencil"
  private _renderStyle: "plain" | "sketch" | "pencil" = "plain";

  // モード状態遷移マシン (hintMode / handleHintMode / objectInsertingMode)
  private readonly stateMachine: EditorStateMachine;

  // ハンドルヒントモードで選択中のハンドル (矢印キー移動に使用)
  private activeHandleForKbd: DragHandleId | undefined;

  // キーボードカーソル位置 (idle 時の移動 & objectInsertingMode の挿入起点)
  private cursorPos: Point = { x: 0, y: 0 };
  private cursorInitialized = false;
  private connectSourceId: string | undefined;
  private connectMousePos: Point | undefined;
  private pendingConnectTrigger = false;
  private pendingConnectTriggerAt = 0;

  // Help overlay
  private helpOverlayEl: HTMLElement | undefined;

  private onSelectionChange: (ids: Set<string>) => void = () => {};
  private onChange: () => void = () => {};
  private onToolChange: (tool: ToolType) => void = () => {};
  private onStyleCycled: () => void = () => {};
  private activePopupCleanup: (() => void) | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.stateMachine = new EditorStateMachine(() => this.render());
    this.selectTool = new SelectTool(this.shapes, (ids) => {
      this.selectedIds = new Set(ids);
      this.onSelectionChange(new Set(ids));
    }, () => this.pushUndo());
    this.currentTool = this.selectTool;
    this.canvas.className = "tool-select";
    this.setupEvents();
    this.resize();
    this.initCursorPos();
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
          if (shape instanceof RectShape || shape instanceof EllipseShape || shape instanceof ArrowShape) {
            if (style.fontSize !== undefined) { shape.labelFontSize = style.fontSize; }
            if (style.fontFamily !== undefined) { shape.labelFontFamily = style.fontFamily; }
            if (style.fontColor !== undefined) { shape.labelFontColor = style.fontColor; }
            if (style.labelAlignH !== undefined) { shape.labelAlignH = style.labelAlignH; }
            if (style.labelAlignV !== undefined) { shape.labelAlignV = style.labelAlignV; }
          }
          if (shape instanceof RectShape && style.cornerRadius !== undefined) {
            shape.cornerRadius = Math.max(0, style.cornerRadius);
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

  setOnStyleCycled(cb: () => void): void {
    this.onStyleCycled = cb;
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

  get sketchy(): boolean { return this._renderStyle !== "plain"; }
  set sketchy(v: boolean) { this._renderStyle = v ? "sketch" : "plain"; this.render(); }

  get renderStyle(): "plain" | "sketch" | "pencil" { return this._renderStyle; }
  set renderStyle(v: "plain" | "sketch" | "pencil") { this._renderStyle = v; this.render(); }

  cycleRenderStyle(): "plain" | "sketch" | "pencil" {
    const order: ("plain" | "sketch" | "pencil")[] = ["plain", "sketch", "pencil"];
    const idx = order.indexOf(this._renderStyle);
    this._renderStyle = order[(idx + 1) % order.length];
    this.render();
    return this._renderStyle;
  }

  toggleSketchy(): boolean {
    this._renderStyle = this._renderStyle === "plain" ? "sketch" : "plain";
    this.render();
    return this._renderStyle !== "plain";
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

  /** カーソル位置をキャンバス左上で初期化する */
  private initCursorPos(): void {
    if (!this.cursorInitialized) {
      this.cursorPos = {
        x: 20,
        y: 20,
      };
      this.cursorInitialized = true;
    }
  }

  /** カーソル位置に指定ツール種別の図形を作成して挿入する */
  private insertShapeAtCursor(toolType: ToolType): void {
    const pt = { ...this.cursorPos };
    const gs = this._gridSize;
    const defaultW = gs * 5;
    const defaultH = gs * 3;
    let shape: Shape;

    switch (toolType) {
      case "rect":
        shape = new RectShape({
          id: nextId(), x: pt.x, y: pt.y, width: defaultW, height: defaultH,
          cornerRadius: this.style.cornerRadius,
          stroke: this.style.stroke, fill: this.style.fill, lineWidth: this.style.lineWidth,
          labelAlignH: this.style.labelAlignH,
          labelAlignV: this.style.labelAlignV,
        });
        break;
      case "ellipse":
        shape = new EllipseShape({
          id: nextId(), cx: pt.x + defaultW / 2, cy: pt.y + defaultH / 2,
          rx: defaultW / 2, ry: defaultH / 2,
          stroke: this.style.stroke, fill: this.style.fill, lineWidth: this.style.lineWidth,
          labelAlignH: this.style.labelAlignH,
          labelAlignV: this.style.labelAlignV,
        });
        break;
      case "arrow":
        shape = new ArrowShape({
          id: nextId(), x1: pt.x, y1: pt.y + defaultH / 2,
          x2: pt.x + defaultW, y2: pt.y + defaultH / 2,
          stroke: this.style.stroke, fill: this.style.fill, lineWidth: this.style.lineWidth,
          labelAlignH: this.style.labelAlignH,
          labelAlignV: this.style.labelAlignV,
        });
        break;
      case "text":
        shape = new TextShape({
          id: nextId(), x: pt.x, y: pt.y + this.style.fontSize,
          text: "Text", fontSize: this.style.fontSize,
          fontFamily: this.style.fontFamily, fontColor: this.style.fontColor,
          stroke: this.style.stroke, fill: this.style.stroke, lineWidth: this.style.lineWidth,
        });
        break;
      case "table":
        shape = new TableShape({
          id: nextId(), x: pt.x, y: pt.y, width: defaultW, height: defaultH,
          rows: 3, cols: 3, cells: Array.from({ length: 3 }, () => new Array(3).fill("")),
          fontSize: this.style.fontSize,
          stroke: this.style.stroke, fill: this.style.fill, lineWidth: this.style.lineWidth,
        });
        break;
      default:
        return;
    }

    if (this._snapToGrid) { this.snapShapeToGrid(shape); }
    this.pushUndo();
    this.shapes.push(shape);
    this.selectedIds = new Set([shape.id]);
    this.selectTool.setSelectedIds(this.selectedIds); // Sync SelectTool state
    this.onSelectionChange(new Set(this.selectedIds));
    this.onChange();
    this.switchToSelect();
    // 作成した図形を選択して objSelect モードへ遷移
    this.stateMachine.enterObjSelect([shape.id]);
    this.render();
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

    if (shape instanceof RectShape || shape instanceof TableShape || shape instanceof ImageShape) {
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

  /** WebView 内でテキスト入力フォーカス中かどうかを返す。
   * INPUT/TEXTAREA にフォーカスがある場合、canvas ショートカットは発動しない。 */
  private static isEditingText(): boolean {
    const el = document.activeElement;
    return el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
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
      if (this.pendingConnectTrigger) {
        const now = Date.now();
        const valid = now - this.pendingConnectTriggerAt <= 1000;
        if (valid && e.key === ">" && !e.ctrlKey && !e.altKey && !e.metaKey && this.selectedIds.size === 1) {
          e.preventDefault();
          this.pendingConnectTrigger = false;
          this.pendingConnectTriggerAt = 0;
          const sourceId = [...this.selectedIds][0];
          this.connectSourceId = sourceId;
          const source = this.shapes.find((s) => s.id === sourceId);
          if (source) {
            const b = source.getBounds();
            this.connectMousePos = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
          }
          this.render();
          return;
        }
        if (e.key !== "Shift") {
          this.pendingConnectTrigger = false;
          this.pendingConnectTriggerAt = 0;
        }
      }

      // --- ハンドルヒントモード中 ---
      if (this.stateMachine.mode === "handleHintMode") {
        if (e.key === "Escape") {
          e.preventDefault();
          this.stateMachine.exitToIdle();
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          const handleId = this.stateMachine.processHandleInput(e.key);
          if (handleId) { this.activeHandleForKbd = handleId; }
          this.render();
          return;
        }
        return; // ハンドルヒントモード中は他のキーを無視
      }

      // --- ヒントモード中 ---
      if (this.stateMachine.mode === "hintMode") {
        if (e.key === "Escape") {
          e.preventDefault();
          this.stateMachine.exitToIdle();
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          const result = this.stateMachine.processHintInput(e.key);
          if (typeof result === "string") {
            this.selectedIds = new Set([result]);
            this.selectTool.setSelectedIds(this.selectedIds); // Sync SelectTool state
            this.onSelectionChange(new Set(this.selectedIds));
            // 図形選択後は objSelect モードへ遷移
            this.stateMachine.enterObjSelect([result]);
          }
          this.render();
          return;
        }
        return; // ヒントモード中は他のキーを無視
      }

      // --- オブジェクト挿入モード中 ---
      if (this.stateMachine.mode === "objectInsertingMode") {
        if (e.key === "Escape") {
          e.preventDefault();
          this.stateMachine.exitToIdle();
          this.render();
          return;
        }
        // ショートカットキーで図形種別を直接選択
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && this.stateMachine.selectInsertByShortcut(e.key)) {
          e.preventDefault();
          this.render(); // UI を更新
          return;
        }
        // 上下キーで図形種別を選択
        if (e.key === "ArrowUp" || e.key === "k") {
          e.preventDefault();
          this.stateMachine.moveInsertSelection(-1);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "j") {
          e.preventDefault();
          this.stateMachine.moveInsertSelection(1);
          return;
        }
        // Enter で確定 → カーソル位置に図形を挿入
        if (e.key === "Enter") {
          e.preventDefault();
          this.insertShapeAtCursor(this.stateMachine.insertSelectedType);
          return;
        }
        // その他のキーは無視
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
        }
        return;
      }

      // --- オブジェクト選択モード中 (ObjSelect) ---
      if (this.stateMachine.mode === "objSelect") {
        // Esc / Ctrl+G で idle へ戻る
        if (e.key === "Escape" || (e.ctrlKey && e.key === "g")) {
          e.preventDefault();
          this.selectedIds.clear();
          this.selectTool.setSelectedIds(this.selectedIds); // Sync SelectTool state
          this.onSelectionChange(new Set(this.selectedIds));
          this.stateMachine.exitToIdle();
          this.render();
          return;
        }
        // i キーで objectInsertingMode へ遷移（選択を解除して新規挿入）
        if (e.key === "i" && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.selectedIds.clear();
          this.selectTool.setSelectedIds(this.selectedIds);
          this.onSelectionChange(new Set(this.selectedIds));
          this.stateMachine.exitToIdle();
          this.stateMachine.enterObjectInsertingMode();
          this.render();
          return;
        }
        // Enter キーで ObjEdit(select) モードへ遷移
        if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          const selected = this.getSelectedShape();
          if (selected) {
            this.stateMachine.enterObjEdit(selected.id, "select");
            this.render();
          }
          return;
        }
        // objSelect モード中は他のキーを通常処理に流す（hjkl移動, Delete削除など）
      }

      // --- オブジェクト編集モード中 (ObjEdit) ---
      if (this.stateMachine.mode === "objEdit") {
        const subMode = this.stateMachine.objEditSubMode;
        
        // Esc / Ctrl+G で objSelect へ戻る（サブモードが select の場合のみ）
        if ((e.key === "Escape" || (e.ctrlKey && e.key === "g")) && subMode === "select") {
          e.preventDefault();
          this.stateMachine.exitObjEditToObjSelect();
          this.render();
          return;
        }

        // select サブモード中のキーバインディング
        if (subMode === "select") {
          if (e.key === "i" && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            this.stateMachine.setObjEditSubMode("labelEdit");
            // labelEdit への遷移時に、実際のラベル編集 UI を起動
            const shape = this.shapes.find((s) => s.id === this.stateMachine.editingShapeId);
            if (shape) {
              this.editSelectedShapeLabel();
            }
            return;
          }
          if (e.key === "e" && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            this.stateMachine.setObjEditSubMode("edgeEdit");
            const shape = this.shapes.find((s) => s.id === this.stateMachine.editingShapeId);
            if (shape) {
              this.showEdgeEditPanel(shape);
            }
            this.render();
            return;
          }
          if (e.key === "p" && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            this.stateMachine.setObjEditSubMode("fillStyleEdit");
            const shape = this.shapes.find((s) => s.id === this.stateMachine.editingShapeId);
            if (shape) {
              this.showFillStyleEditPanel(shape);
            }
            this.render();
            return;
          }
        }

        // labelEdit/edgeEdit/fillStyleEdit 中は特定のキーハンドリングを UI 側で処理
        // ここでは Esc ハンドリングをスキップして、UI 側の cleanup に任せる
      }

      // テキスト入力中かどうかを一度取得し、以降のショートカットの分岐に利用
      const editingText = CanvasEditor.isEditingText();

      // --- INPUT/TEXTAREA 向け Emacs キーバインド（テキスト入力中のみ） ---
      if (editingText) {
        // Ctrl+h → Backspace 相当（左の文字を1文字削除）
        if (e.ctrlKey && e.key === "h") {
          e.preventDefault();
          const input = e.target as HTMLInputElement;
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? start;
          if (start !== end) {
            input.value = input.value.slice(0, start) + input.value.slice(end);
            input.setSelectionRange(start, start);
          } else if (start > 0) {
            input.value = input.value.slice(0, start - 1) + input.value.slice(start);
            input.setSelectionRange(start - 1, start - 1);
          }
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        // Ctrl+j → 改行挿入 (TEXTAREA) / 確定 (INPUT)
        if (e.ctrlKey && e.key === "j") {
          e.preventDefault();
          const el = e.target as HTMLElement;
          if (el.tagName === "TEXTAREA") {
            const ta = el as HTMLTextAreaElement;
            const start = ta.selectionStart ?? 0;
            const end = ta.selectionEnd ?? start;
            ta.value = ta.value.slice(0, start) + "\n" + ta.value.slice(end);
            ta.setSelectionRange(start + 1, start + 1);
            ta.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            el.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
            );
          }
          return;
        }
        // Ctrl+n → 次の行へ（textarea のみ）
        if (e.ctrlKey && e.key === "n") {
          e.preventDefault();
          const el = e.target as HTMLInputElement;
          if (el.tagName === "TEXTAREA") {
            const ta = el as HTMLTextAreaElement;
            const pos = ta.selectionStart ?? 0;
            const lineStart = ta.value.lastIndexOf("\n", pos - 1) + 1;
            const col = pos - lineStart;
            const nextNl = ta.value.indexOf("\n", pos);
            if (nextNl !== -1) {
              const nextLineStart = nextNl + 1;
              const nextLineEnd = ta.value.indexOf("\n", nextLineStart);
              const nextLineLen = (nextLineEnd === -1 ? ta.value.length : nextLineEnd) - nextLineStart;
              ta.setSelectionRange(nextLineStart + Math.min(col, nextLineLen), nextLineStart + Math.min(col, nextLineLen));
            } else {
              ta.setSelectionRange(ta.value.length, ta.value.length);
            }
          }
          return;
        }
        // Ctrl+p → 前の行へ（textarea のみ）
        if (e.ctrlKey && e.key === "p") {
          e.preventDefault();
          const el = e.target as HTMLInputElement;
          if (el.tagName === "TEXTAREA") {
            const ta = el as HTMLTextAreaElement;
            const pos = ta.selectionStart ?? 0;
            const lineStart = ta.value.lastIndexOf("\n", pos - 1) + 1;
            const col = pos - lineStart;
            if (lineStart > 0) {
              const prevLineEnd = lineStart - 1;
              const prevLineStart = ta.value.lastIndexOf("\n", prevLineEnd - 1) + 1;
              const prevLineLen = prevLineEnd - prevLineStart;
              ta.setSelectionRange(prevLineStart + Math.min(col, prevLineLen), prevLineStart + Math.min(col, prevLineLen));
            } else {
              ta.setSelectionRange(0, 0);
            }
          }
          return;
        }
        // Ctrl+f → 1文字前進
        if (e.ctrlKey && e.key === "f") {
          e.preventDefault();
          const el = e.target as HTMLInputElement;
          const pos = Math.min((el.selectionStart ?? 0) + 1, el.value.length);
          el.setSelectionRange(pos, pos);
          return;
        }
        // Ctrl+b → 1文字後退
        if (e.ctrlKey && e.key === "b") {
          e.preventDefault();
          const el = e.target as HTMLInputElement;
          const pos = Math.max((el.selectionStart ?? 0) - 1, 0);
          el.setSelectionRange(pos, pos);
          return;
        }
        // Ctrl+a → 行頭へ移動
        if (e.ctrlKey && e.key === "a") {
          e.preventDefault();
          const el = e.target as HTMLInputElement;
          if (el.tagName === "TEXTAREA") {
            const ta = el as HTMLTextAreaElement;
            const pos = ta.selectionStart ?? 0;
            const lineStart = ta.value.lastIndexOf("\n", pos - 1) + 1;
            ta.setSelectionRange(lineStart, lineStart);
          } else {
            el.setSelectionRange(0, 0);
          }
          return;
        }
        // Ctrl+e → 行末へ移動
        if (e.ctrlKey && e.key === "e") {
          e.preventDefault();
          const el = e.target as HTMLInputElement;
          if (el.tagName === "TEXTAREA") {
            const ta = el as HTMLTextAreaElement;
            const pos = ta.selectionStart ?? 0;
            const nextNl = ta.value.indexOf("\n", pos);
            const lineEnd = nextNl === -1 ? ta.value.length : nextNl;
            ta.setSelectionRange(lineEnd, lineEnd);
          } else {
            const len = el.value.length;
            el.setSelectionRange(len, len);
          }
          return;
        }
        // Ctrl+d → カーソル位置の1文字削除（DEL相当）
        if (e.ctrlKey && e.key === "d") {
          e.preventDefault();
          const el = e.target as HTMLInputElement;
          const start = el.selectionStart ?? 0;
          const end = el.selectionEnd ?? start;
          if (start !== end) {
            el.value = el.value.slice(0, start) + el.value.slice(end);
            el.setSelectionRange(start, start);
          } else if (start < el.value.length) {
            el.value = el.value.slice(0, start) + el.value.slice(start + 1);
            el.setSelectionRange(start, start);
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        // Ctrl+k → カーソルから行末まで削除
        if (e.ctrlKey && e.key === "k") {
          e.preventDefault();
          const el = e.target as HTMLInputElement;
          const start = el.selectionStart ?? 0;
          if (el.tagName === "TEXTAREA") {
            const ta = el as HTMLTextAreaElement;
            const nextNl = ta.value.indexOf("\n", start);
            if (start === nextNl) {
              // 行末にいる場合は改行文字を削除
              ta.value = ta.value.slice(0, start) + ta.value.slice(start + 1);
            } else {
              const lineEnd = nextNl === -1 ? ta.value.length : nextNl;
              ta.value = ta.value.slice(0, start) + ta.value.slice(lineEnd);
            }
            ta.setSelectionRange(start, start);
          } else {
            el.value = el.value.slice(0, start);
            el.setSelectionRange(start, start);
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        // テキスト入力中はキャンバスショートカットを無視
        return;
      }

      // ---- 以下: canvas ショートカット（テキスト入力中は実行しない） ----

      // `->` で Connect モードを開始
      if (e.key === "-" && !e.ctrlKey && !e.altKey && !e.metaKey && this.selectedIds.size === 1) {
        e.preventDefault();
        this.pendingConnectTrigger = true;
        this.pendingConnectTriggerAt = Date.now();
        return;
      }

      // `f` キー: 図形選択済み→ハンドルヒント、未選択→図形ヒント
      if (e.key === "f" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        if (this.selectedIds.size === 1) {
          const shapeId = [...this.selectedIds][0];
          const shape = this.shapes.find((s) => s.id === shapeId);
          if (shape) { this.stateMachine.enterHandleHintMode(shape); }
        } else if (this.shapes.length > 0) {
          this.stateMachine.enterHintMode(this.shapes);
        }
        return;
      }

      // `s` キー: スタイル切替
      if (e.key === "s" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        this.cycleRenderStyle();
        this.onStyleCycled();
        return;
      }

      // `i` キー: Select状態でラベル編集、未選択でオブジェクト挿入モード
      if (e.key === "i" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        // idle モードでのみ objectInsertingMode に入る
        if (this.stateMachine.mode === "idle") {
          // 選択状態をクリアして objectInsertingMode に入る
          this.selectedIds.clear();
          this.selectTool.setSelectedIds(this.selectedIds);
          this.onSelectionChange(new Set(this.selectedIds));
          this.stateMachine.enterObjectInsertingMode();
          this.render();
          return;
        }
      }

      // `?` キーでヘルプオーバーレイ表示/非表示
      if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        this.toggleHelpOverlay();
        return;
      }

      // `Escape` キー
      if (e.key === "Escape") {
        if (this.connectSourceId) {
          this.connectSourceId = undefined;
          this.connectMousePos = undefined;
          this.render();
          return;
        }
        if (this.helpOverlayEl) { this.hideHelpOverlay(); return; }
        if (this.activeHandleForKbd) {
          this.activeHandleForKbd = undefined;
          this.render();
          return;
        }
        if (this.selectedIds.size > 0) {
          this.selectedIds.clear();
          this.onSelectionChange(new Set());
          this.render();
        }
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedIds.size > 0) {
        this.deleteSelected();
        return;
      }

      // 矢印キー / hjkl / Ctrl+n,p で図形 or ハンドル or カーソル移動
      const isArrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key);
      const isVimMove = ["h", "j", "k", "l"].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey;
      const isEmacsMove = e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "n" || e.key === "p");

      // 図形未選択時はカーソル移動
      if ((isArrow || isVimMove || isEmacsMove) && this.selectedIds.size === 0) {
        e.preventDefault();
        const step = this._gridSize;
        let dx = 0, dy = 0;
        if (e.key === "ArrowLeft"  || e.key === "h") { dx = -step; }
        if (e.key === "ArrowRight" || e.key === "l") { dx =  step; }
        if (e.key === "ArrowUp"    || e.key === "k") { dy = -step; }
        if (e.key === "ArrowDown"  || e.key === "j") { dy =  step; }
        if (e.key === "n") { dy =  step; }
        if (e.key === "p") { dy = -step; }
        this.cursorPos.x += dx;
        this.cursorPos.y += dy;
        this.render();
        return;
      }

      const hasMoveTarget = this.activeHandleForKbd
        ? this.selectedIds.size === 1
        : this.selectedIds.size > 0;
      if ((isArrow || isVimMove || isEmacsMove) && hasMoveTarget) {
        e.preventDefault();
        const keyboardMoveStep = 10;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft"  || e.key === "h") { dx = -keyboardMoveStep; }
        if (e.key === "ArrowRight" || e.key === "l") { dx =  keyboardMoveStep; }
        if (e.key === "ArrowUp"    || e.key === "k") { dy = -keyboardMoveStep; }
        if (e.key === "ArrowDown"  || e.key === "j") { dy =  keyboardMoveStep; }
        if (e.key === "n") { dy =  keyboardMoveStep; }  // Ctrl+n
        if (e.key === "p") { dy = -keyboardMoveStep; }  // Ctrl+p
        // キー長押し時の auto-repeat では pushUndo しない（1操作 = 1アンドゥ）
        if (!e.repeat) { this.pushUndo(); }
        if (this.activeHandleForKbd && this.selectedIds.size === 1) {
          // ハンドル単体移動モード
          const shapeId = [...this.selectedIds][0];
          const shape = this.shapes.find((s) => s.id === shapeId);
          if (shape) { applyHandleDelta(shape, this.activeHandleForKbd, dx, dy); }
        } else {
          for (const shape of this.shapes.filter((s) => this.selectedIds.has(s.id))) {
            if (shape instanceof ArrowShape) {
              shape.x1 += dx; shape.y1 += dy;
              shape.x2 += dx; shape.y2 += dy;
            } else if (shape instanceof EllipseShape) {
              shape.cx += dx; shape.cy += dy;
            } else if (shape instanceof RectShape || shape instanceof TextShape || shape instanceof TableShape || shape instanceof ImageShape) {
              shape.x += dx; shape.y += dy;
            }
          }
        }
        this.onChange();
        this.render();
        return;
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
        // Ctrl+G → Escape 同等の動き
        e.preventDefault();
        if (this.helpOverlayEl) { this.hideHelpOverlay(); return; }
        if (this.activeHandleForKbd) {
          this.activeHandleForKbd = undefined;
          this.render();
          return;
        }
        if (this.selectedIds.size > 0) {
          this.selectedIds.clear();
          this.onSelectionChange(new Set());
          this.render();
        }
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "g" && e.shiftKey) {
        e.preventDefault();
        this.groupSelected();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "u") {
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
    if (this.connectSourceId) {
      e.preventDefault(); // Prevent any default behavior
      const source = this.shapes.find((s) => s.id === this.connectSourceId);
      if (!source) {
        this.connectSourceId = undefined;
        this.connectMousePos = undefined;
        this.render();
        return;
      }
      const pt = this.getPoint(e);
      const target = this.findShapeAtPoint(pt);
      if (target && target.id !== source.id) {
        const sourceCenter = getShapeCenter(source);
        const targetCenter = getShapeCenter(target);
        const start = getShapeBoundaryPoint(source, sourceCenter, targetCenter);
        const end = getShapeBoundaryPoint(target, targetCenter, sourceCenter);
        const arrow = new ArrowShape({
          id: nextId(),
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          stroke: this.style.stroke,
          fill: this.style.fill,
          lineWidth: this.style.lineWidth,
          labelAlignH: this.style.labelAlignH,
          labelAlignV: this.style.labelAlignV,
        });
        this.pushUndo();
        this.shapes.push(arrow);
        this.selectedIds = new Set([arrow.id]);
        this.selectTool.setSelectedIds(this.selectedIds); // Sync SelectTool state
        this.onSelectionChange(new Set(this.selectedIds));
        this.onChange();
      }
      this.connectSourceId = undefined;
      this.connectMousePos = undefined;
      this.isDragging = false; // Ensure clean state
      this.render();
      return;
    }
    // objectInsertingMode 中のドラッグ: 選択した図形種別でツールを確定して描画開始
    // (currentTool が selectTool のままだと rubber-band 選択が誤発火するため)
    if (this.stateMachine.mode === "objectInsertingMode") {
      const toolType = this.stateMachine.insertSelectedType;
      this.setTool(toolType);
      this.onToolChange(toolType);
      this.stateMachine.exitToIdle();
    }
    this.isDragging = true;
    this.currentTool.onMouseDown(this.getToolPoint(e), this.style, { shiftKey: e.shiftKey });
    this.render();
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.connectSourceId) {
      this.connectMousePos = this.getPoint(e);
      this.render();
      return;
    }
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
      // 作成した図形を自動選択
      this.selectedIds = new Set([shape.id]);
      this.selectTool.setSelectedIds(this.selectedIds); // Sync SelectTool state
      this.onSelectionChange(new Set(this.selectedIds));
      this.onChange();
      this.switchToSelect();
      // 作成した図形を選択して objSelect モードへ遷移
      this.stateMachine.enterObjSelect([shape.id]);
    } else if (wasDraggingSelect && this.selectedIds.size > 0) {
      if (this._snapToGrid) {
        this.snapSelectedShapesToGrid();
      }
      // Notify change after move / resize (undo was pushed by SelectTool)
      this.onChange();
    }
    this.render();
  }

  private findShapeAtPoint(pt: Point): Shape | undefined {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i];
      if (hitTest(shape, pt, 6)) {
        return shape;
      }
    }
    return undefined;
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
    renderShapes(this.ctx, this.shapes, preview, this.selectedIds, rubberBand, this._renderStyle);
    // カーソルを描画（図形未選択時 or objectInsertingMode 時）
    if (this.selectedIds.size === 0 || this.stateMachine.mode === "objectInsertingMode") {
      this.drawCursor();
    }
    if (this.stateMachine.mode === "hintMode") { this.drawHintLabels(); }
    if (this.stateMachine.mode === "handleHintMode") { this.drawHandleHints(); }
    if (this.activeHandleForKbd && this.selectedIds.size === 1) { this.drawActiveHandleIndicator(); }
    if (this.stateMachine.mode === "objectInsertingMode") { this.drawInsertIndicator(); }
    if (this.stateMachine.mode === "objSelect") { this.drawObjSelectIndicator(); }
    if (this.stateMachine.mode === "objEdit") { this.drawObjEditIndicator(); }
    if (this.connectSourceId) { this.drawConnectIndicator(); }
  }

  exitObjectInsertingMode(): void {
    this.stateMachine.exitToIdle();
  }

  isObjectInsertingMode(): boolean {
    return this.stateMachine.mode === "objectInsertingMode";
  }

  private drawHandleHints(): void {
    if (this.selectedIds.size !== 1) { return; }
    const shapeId = [...this.selectedIds][0];
    const shape = this.shapes.find((s) => s.id === shapeId);
    if (!shape) { return; }

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const FONT_SIZE = 12;
    const PAD = 5;
    ctx.font = `bold ${FONT_SIZE}px monospace`;

    const entries: { pt: Point; key: string }[] = [];
    if (shape instanceof ArrowShape) {
      entries.push({ pt: { x: shape.x1, y: shape.y1 }, key: "s" });
      entries.push({ pt: { x: shape.x2, y: shape.y2 }, key: "e" });
    } else if (shape instanceof RectShape || shape instanceof EllipseShape) {
      const h = getShapeHandles(shape);
      entries.push({ pt: h.tl, key: "s" });
      entries.push({ pt: h.br, key: "e" });
    } else {
      const h = getShapeHandles(shape);
      entries.push({ pt: h.tl, key: "1" });
      entries.push({ pt: h.tr, key: "2" });
      entries.push({ pt: h.bl, key: "3" });
      entries.push({ pt: h.br, key: "4" });
    }

    for (const { pt, key } of entries) {
      const tw = ctx.measureText(key).width;
      const bgX = pt.x - tw / 2 - PAD;
      const bgY = pt.y - FONT_SIZE / 2 - PAD;
      const bgW = tw + PAD * 2;
      const bgH = FONT_SIZE + PAD * 2;

      ctx.fillStyle = "#ff9500";
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(bgX, bgY, bgW, bgH, 3); }
      else { ctx.rect(bgX, bgY, bgW, bgH); }
      ctx.fill();
      ctx.strokeStyle = "#cc6f00";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#000";
      ctx.fillText(key, pt.x - tw / 2, pt.y + FONT_SIZE / 2 - 1);
    }

    ctx.restore();
  }

  private drawActiveHandleIndicator(): void {
    if (!this.activeHandleForKbd || this.selectedIds.size !== 1) { return; }
    const shapeId = [...this.selectedIds][0];
    const shape = this.shapes.find((s) => s.id === shapeId);
    if (!shape) { return; }

    let pt: Point | undefined;
    if (shape instanceof ArrowShape) {
      if (this.activeHandleForKbd === "start") { pt = { x: shape.x1, y: shape.y1 }; }
      else if (this.activeHandleForKbd === "end") { pt = { x: shape.x2, y: shape.y2 }; }
    } else {
      const h = getShapeHandles(shape);
      pt = h[this.activeHandleForKbd as keyof typeof h] as Point | undefined;
    }
    if (!pt) { return; }

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#ff9500";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private toggleHelpOverlay(): void {
    if (this.helpOverlayEl) {
      this.hideHelpOverlay();
    } else {
      this.showHelpOverlay();
    }
  }

  private showHelpOverlay(): void {
    const container = this.canvas.parentElement ?? document.body;
    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:absolute", "top:50%", "left:50%",
      "transform:translate(-50%,-50%)",
      "background:var(--vscode-editorWidget-background,#1e1e1e)",
      "color:var(--vscode-editor-foreground,#ccc)",
      "border:1px solid var(--vscode-widget-border,#555)",
      "border-radius:6px", "padding:20px 28px",
      "font-size:13px", "font-family:monospace",
      "z-index:100", "min-width:340px",
      "box-shadow:0 4px 20px rgba(0,0,0,0.5)",
      "pointer-events:auto",
    ].join(";");

    const shortcuts: [string, string][] = [
      ["f",          "図形をヒント選択 / ハンドル選択"],
      ["f (選択後)",   "始点・終点・角を選択してサイズ調整"],
      ["1~4 / s,e",  "ハンドルモード: 角(1-4) or 始端(s)/終端(e) 選択"],
      ["h / ←",      "左へ移動 (未選択時はカーソル移動)"],
      ["j / ↓",      "下へ移動 (未選択時はカーソル移動)"],
      ["k / ↑",      "上へ移動 (未選択時はカーソル移動)"],
      ["l / →",      "右へ移動 (未選択時はカーソル移動)"],
      ["i",          "図形挿入モード (R/E/A/T/G or ↑↓で選択 → Enter で確定)"],
      ["->",         "図形接続モード (選択中に入力、次クリックで矢印作成)"],
      ["s",          "描画スタイル切替 (Plain→Sketch→Pencil)"],
      ["Escape / Ctrl+G", "ハンドル解除 → 選択解除"],
      ["Del / BS",   "図形を削除"],
      ["F2",         "ラベル編集"],
      ["Ctrl+Z",     "元に戻す"],
      ["Ctrl+Y",     "やり直す"],
      ["Ctrl+C",     "コピー"],
      ["Ctrl+V",     "貼り付け"],
      ["Ctrl+Shift+G","グループ化"],
      ["Ctrl+U",     "グループ解除"],
      ["?",          "このヘルプを表示/非表示"],
    ];

    const title = document.createElement("div");
    title.textContent = "Keyboard Shortcuts";
    title.style.cssText = "font-size:15px;font-weight:bold;margin-bottom:14px;color:var(--vscode-editor-foreground,#eee)";
    overlay.appendChild(title);

    const table = document.createElement("table");
    table.style.cssText = "border-collapse:collapse;width:100%";
    for (const [key, desc] of shortcuts) {
      const tr = document.createElement("tr");
      const tdKey = document.createElement("td");
      tdKey.textContent = key;
      tdKey.style.cssText = "padding:3px 16px 3px 0;white-space:nowrap;color:var(--vscode-textPreformat-foreground,#9cdcfe)";
      const tdDesc = document.createElement("td");
      tdDesc.textContent = desc;
      tdDesc.style.cssText = "padding:3px 0;color:var(--vscode-editor-foreground,#ccc)";
      tr.appendChild(tdKey);
      tr.appendChild(tdDesc);
      table.appendChild(tr);
    }
    overlay.appendChild(table);

    const hint = document.createElement("div");
    hint.textContent = "Press ? or Escape to close";
    hint.style.cssText = "margin-top:14px;font-size:11px;opacity:0.6;text-align:center";
    overlay.appendChild(hint);

    container.appendChild(overlay);
    this.helpOverlayEl = overlay;
  }

  private hideHelpOverlay(): void {
    if (this.helpOverlayEl) {
      this.helpOverlayEl.parentElement?.removeChild(this.helpOverlayEl);
      this.helpOverlayEl = undefined;
    }
  }

  private drawHintLabels(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const FONT_SIZE = 12;
    const PAD_X = 5;
    const PAD_Y = 3;
    ctx.font = `bold ${FONT_SIZE}px monospace`;

    for (const [label, shapeId] of this.stateMachine.hintMap) {
      // 既入力部分が一致しない候補はスキップ
      if (!label.startsWith(this.stateMachine.hintInput)) { continue; }

      const shape = this.shapes.find((s) => s.id === shapeId);
      if (!shape) { continue; }

      const b = shape.getBounds();
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;

      const fullW = ctx.measureText(label).width;
      const typedW = this.stateMachine.hintInput.length > 0 ? ctx.measureText(this.stateMachine.hintInput).width : 0;
      const remaining = label.slice(this.stateMachine.hintInput.length);

      const bgX = cx - fullW / 2 - PAD_X;
      const bgY = cy - FONT_SIZE / 2 - PAD_Y;
      const bgW = fullW + PAD_X * 2;
      const bgH = FONT_SIZE + PAD_Y * 2;

      // バッジ背景（黄色）
      ctx.fillStyle = "#f5c518";
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(bgX, bgY, bgW, bgH, 3);
      } else {
        ctx.rect(bgX, bgY, bgW, bgH);
      }
      ctx.fill();

      // 枠線
      ctx.strokeStyle = "#c9a000";
      ctx.lineWidth = 1;
      ctx.stroke();

      const textX = cx - fullW / 2;
      const textY = cy + FONT_SIZE / 2 - 1;

      // 既入力部分（灰色）
      if (this.stateMachine.hintInput.length > 0) {
        ctx.fillStyle = "#888";
        ctx.fillText(this.stateMachine.hintInput, textX, textY);
      }

      // 未入力部分（黒）
      ctx.fillStyle = "#000";
      ctx.fillText(remaining, textX + typedW, textY);
    }

    ctx.restore();
  }

  /** カーソル十字を描画する */
  private drawCursor(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { x, y } = this.cursorPos;
    const arm = 10;
    ctx.strokeStyle = "#ff6600";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    // 横線
    ctx.beginPath();
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x + arm, y);
    ctx.stroke();
    // 縦線
    ctx.beginPath();
    ctx.moveTo(x, y - arm);
    ctx.lineTo(x, y + arm);
    ctx.stroke();
    // 中心点
    ctx.fillStyle = "#ff6600";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** objectInsertingMode: 図形選択メニューを描画する */
  private drawInsertIndicator(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const types = this.stateMachine.insertShapeTypes;
    const selIdx = this.stateMachine.insertSelectedIndex;
    const LABEL_MAP: Record<string, string> = {
      rect: "■ Rect (R)", ellipse: "● Ellipse (E)", arrow: "→ Arrow (A)",
      text: "T Text (T)", table: "⊞ Table (G)",
    };

    const fontSize = 14;
    const lineH = fontSize + 10;
    const padX = 14;
    const padY = 8;
    const totalH = lineH * types.length + padY * 2;

    ctx.font = `${fontSize}px monospace`;
    let maxW = 0;
    for (const t of types) {
      const w = ctx.measureText(LABEL_MAP[t] ?? t).width;
      if (w > maxW) { maxW = w; }
    }
    const boxW = maxW + padX * 2;
    const boxX = logicalW / 2 - boxW / 2;
    const boxY = logicalH / 2 - totalH / 2;

    // 背景
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(boxX, boxY, boxW, totalH, 6); }
    else { ctx.rect(boxX, boxY, boxW, totalH); }
    ctx.fill();

    // タイトル的なヘッダ
    // 各行を描画
    for (let i = 0; i < types.length; i++) {
      const itemY = boxY + padY + i * lineH;
      const label = LABEL_MAP[types[i]] ?? types[i];
      const isSelected = i === selIdx;

      if (isSelected) {
        ctx.fillStyle = "rgba(74, 144, 217, 0.6)";
        ctx.fillRect(boxX + 2, itemY, boxW - 4, lineH);
      }

      ctx.fillStyle = isSelected ? "#fff" : "#aaa";
      ctx.fillText(label, boxX + padX, itemY + fontSize + 2);
    }

    // 下部ヒント
    const hint = "R/E/A/T/G: select / ↑↓: move / Enter: insert / Esc: cancel";
    ctx.font = `11px monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    const hintW = ctx.measureText(hint).width;
    ctx.fillText(hint, logicalW / 2 - hintW / 2, boxY + totalH + 16);

    ctx.restore();
  }

  private drawConnectIndicator(): void {
    if (!this.connectSourceId || !this.connectMousePos) { return; }
    const source = this.shapes.find((s) => s.id === this.connectSourceId);
    if (!source) { return; }

    const b = source.getBounds();
    const start = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const end = this.connectMousePos;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#ff8a00";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const msg = "Connect mode: click target shape (Esc to cancel)";
    ctx.font = "12px monospace";
    const textW = ctx.measureText(msg).width;
    const boxW = textW + 12;
    const boxH = 22;
    const boxX = 12;
    const boxY = 12;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      ctx.fill();
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(msg, boxX + 6, boxY + 15);
    ctx.restore();
  }

  /** objSelect モードの状態表示（画面下部にステータスバー風） */
  private drawObjSelectIndicator(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = this.selectedIds.size;
    const msg = `ObjSelect: ${count} shape${count !== 1 ? "s" : ""} selected | i: insert | Enter: edit | ->: connect | Esc: idle`;
    ctx.font = "12px monospace";
    const textW = ctx.measureText(msg).width;
    const boxW = textW + 16;
    const boxH = 24;
    const boxX = logicalW / 2 - boxW / 2;
    const boxY = logicalH - boxH - 12;

    // 背景
    ctx.fillStyle = "rgba(74, 144, 217, 0.85)";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      ctx.fill();
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }

    // テキスト
    ctx.fillStyle = "#ffffff";
    ctx.fillText(msg, boxX + 8, boxY + 16);

    ctx.restore();
  }

  /** objEdit モードの状態表示（画面下部にステータスバー風） */
  private drawObjEditIndicator(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const subMode = this.stateMachine.objEditSubMode;
    let msg = "";
    
    switch (subMode) {
      case "select":
        msg = "ObjEdit(select): i: label | e: edge | p: fill | Esc: back to ObjSelect";
        break;
      case "labelEdit":
        msg = "ObjEdit(labelEdit): editing label... | Ctrl+Enter: save | Esc: cancel";
        break;
      case "edgeEdit":
        msg = "ObjEdit(edgeEdit): [TODO Phase 3] | Esc: back to select";
        break;
      case "fillStyleEdit":
        msg = "ObjEdit(fillStyleEdit): [TODO Phase 4] | Esc: back to select";
        break;
    }

    ctx.font = "12px monospace";
    const textW = ctx.measureText(msg).width;
    const boxW = textW + 16;
    const boxH = 24;
    const boxX = logicalW / 2 - boxW / 2;
    const boxY = logicalH - boxH - 12;

    // 背景（緑系で ObjSelect と区別）
    ctx.fillStyle = "rgba(56, 182, 92, 0.85)";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      ctx.fill();
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }

    // テキスト
    ctx.fillStyle = "#ffffff";
    ctx.fillText(msg, boxX + 8, boxY + 16);

    ctx.restore();
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
      } else if (e.key === "Escape" || (e.key === "g" && e.ctrlKey && !e.shiftKey)) {
        e.preventDefault();
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
    if (shape instanceof RectShape || shape instanceof EllipseShape || shape instanceof ArrowShape) {
      this.editShapeLabel(shape);
    }
  }

  private editShapeLabel(shape: RectShape | EllipseShape | ArrowShape): void {
    const b = shape.getBounds();
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const container = this.canvas.parentElement!;
    const canvasRect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    // textarea を使い Enter で改行を挿入可能にする
    const textarea = document.createElement("textarea");
    textarea.value = shape.label ?? "";
    textarea.placeholder = "Label";
    textarea.rows = 3;
    textarea.style.position = "absolute";
    textarea.style.left = `${canvasRect.left - contRect.left + cx - 60}px`;
    textarea.style.top = `${canvasRect.top - contRect.top + cy - 36}px`;
    textarea.style.width = "120px";
    textarea.style.fontSize = `${shape.labelFontSize ?? this.style.fontSize}px`;
    textarea.style.fontFamily = shape.labelFontFamily ?? this.style.fontFamily;
    textarea.style.border = "1px solid #007acc";
    textarea.style.outline = "none";
    textarea.style.padding = "2px 4px";
    textarea.style.background = "#fff";
    textarea.style.color = shape.labelFontColor ?? shape.stroke;
    textarea.style.zIndex = "10";
    textarea.style.resize = "none";
    container.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let committed = false;

    const commit = () => {
      if (committed) { return; }
      committed = true;
      const text = textarea.value.trim();
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
      committed = true; // cancel 時も再 commit しない
      this.activePopupCleanup = undefined;
      textarea.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutsideMouseDown, true);
      if (textarea.parentElement) {
        textarea.parentElement.removeChild(textarea);
      }
      // objEdit(labelEdit) モードからの終了時は objEdit(select) へ戻る
      if (this.stateMachine.mode === "objEdit" && this.stateMachine.objEditSubMode === "labelEdit") {
        this.stateMachine.setObjEditSubMode("select");
        this.render();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Enter / Escape / Ctrl+G で確定、素の Enter はブラウザに委ねて改行挿入
      if ((e.key === "Enter" && e.ctrlKey) || e.key === "Escape" || (e.key === "g" && e.ctrlKey && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation(); // window の Escape ハンドラに伝播させない（選択を維持）
        commit();
      }
    };

    // textarea の外をマウスクリックしたときだけ確定（blur は使わない）
    const onOutsideMouseDown = (e: MouseEvent) => {
      if (!textarea.contains(e.target as Node)) {
        commit();
      }
    };

    textarea.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutsideMouseDown, true);
    this.activePopupCleanup = cleanup;
  }

  /** edgeEdit パネルを表示して stroke と lineWidth を編集 */
  private showEdgeEditPanel(shape: Shape): void {
    const container = this.canvas.parentElement!;
    
    // 編集可能なプロパティを持つ図形のみ対象
    if (!("stroke" in shape) || !("lineWidth" in shape)) {
      return;
    }

    const originalStroke = shape.stroke;
    const originalLineWidth = shape.lineWidth;

    // EdgeEditPanel を作成
    const panel = new EdgeEditPanel({
      stroke: originalStroke,
      lineWidth: originalLineWidth,
      container,
      onChange: (stroke, lineWidth) => {
        // プレビュー: 即座に図形プロパティを更新
        (shape as any).stroke = stroke;
        (shape as any).lineWidth = lineWidth;
        this.render();
      },
      onCommit: (stroke, lineWidth) => {
        // 確定: 変更があれば undo スタックに追加
        if (stroke !== originalStroke || lineWidth !== originalLineWidth) {
          this.pushUndo();
          (shape as any).stroke = stroke;
          (shape as any).lineWidth = lineWidth;
          this.onChange();
        }
        // objEdit(select) に戻る
        this.stateMachine.setObjEditSubMode("select");
        this.render();
      },
      onCancel: () => {
        // キャンセル: objEdit(select) に戻る
        this.stateMachine.setObjEditSubMode("select");
        this.render();
      },
    });

    // cleanup 登録
    this.activePopupCleanup = () => {
      // パネルは内部で destroy されるため、特に追加処理は不要
    };
  }

  /** fillStyleEdit パネルを表示して fill, opacity, cornerRadius を編集 */
  private showFillStyleEditPanel(shape: Shape): void {
    const container = this.canvas.parentElement!;
    
    // 編集可能なプロパティを持つ図形のみ対象
    if (!("fill" in shape)) {
      return;
    }

    const originalFill = shape.fill;
    const originalOpacity = (shape as any).opacity as number | undefined;
    const originalCornerRadius = shape instanceof RectShape ? shape.cornerRadius : undefined;
    const isRect = shape instanceof RectShape;

    // FillStyleEditPanel を作成
    const panel = new FillStyleEditPanel({
      fill: originalFill,
      opacity: originalOpacity,
      cornerRadius: originalCornerRadius,
      isRect,
      container,
      onChange: (fill, opacity, cornerRadius) => {
        // プレビュー: 即座に図形プロパティを更新
        (shape as any).fill = fill;
        if (opacity !== undefined) {
          (shape as any).opacity = opacity;
        }
        if (isRect && cornerRadius !== undefined) {
          (shape as RectShape).cornerRadius = cornerRadius;
        }
        this.render();
      },
      onCommit: (fill, opacity, cornerRadius) => {
        // 確定: 変更があれば undo スタックに追加
        let changed = false;
        if (fill !== originalFill) { changed = true; }
        if (opacity !== originalOpacity) { changed = true; }
        if (isRect && cornerRadius !== originalCornerRadius) { changed = true; }
        
        if (changed) {
          this.pushUndo();
          (shape as any).fill = fill;
          if (opacity !== undefined) {
            (shape as any).opacity = opacity;
          }
          if (isRect && cornerRadius !== undefined) {
            (shape as RectShape).cornerRadius = cornerRadius;
          }
          this.onChange();
        }
        // objEdit(select) に戻る
        this.stateMachine.setObjEditSubMode("select");
        this.render();
      },
      onCancel: () => {
        // キャンセル: objEdit(select) に戻る
        this.stateMachine.setObjEditSubMode("select");
        this.render();
      },
    });

    // cleanup 登録
    this.activePopupCleanup = () => {
      // パネルは内部で destroy されるため、特に追加処理は不要
    };
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
      } else if (e.key === "Escape" || (e.key === "g" && e.ctrlKey && !e.shiftKey)) {
        e.preventDefault();
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
    if (!shape) {
      this.showCanvasContextMenu(pt, e);
      return;
    }

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

  /** Show context menu on empty canvas area */
  private showCanvasContextMenu(pt: Point, e: MouseEvent): void {
    this.dismissPopup();

    const container = this.canvas.parentElement!;
    const canvasRect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.style.left = `${canvasRect.left - contRect.left + pt.x}px`;
    menu.style.top = `${canvasRect.top - contRect.top + pt.y}px`;

    const items: { label: string; action: () => void }[] = [
      { label: "Paste", action: () => this.paste() },
      { label: "Undo", action: () => this.undo() },
      { label: "Redo", action: () => this.redo() },
      { label: "Select All", action: () => { this.selectedIds = new Set(this.shapes.map(s => s.id)); this.onSelectionChange(new Set(this.selectedIds)); this.render(); } },
    ];

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
    requestAnimationFrame(() => {
      window.addEventListener("mousedown", onOutside);
      window.addEventListener("keydown", onEsc);
    });
    this.activePopupCleanup = cleanup;
  }

  /** Open inline editor appropriate for the shape type */
  private openShapeEditor(shape: Shape, pt: Point): void {
    switch (shape.type) {
      case "rect":
      case "ellipse":
      case "arrow":
        this.editShapeLabel(shape as RectShape | EllipseShape | ArrowShape);
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
        items.push({ label: "Edit Label", action: () => this.editShapeLabel(shape as RectShape | EllipseShape | ArrowShape) });
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
      if (e.key === "Enter" || e.key === "Escape" || (e.key === "g" && e.ctrlKey && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation(); // window の Escape ハンドラに伝播させない（選択を維持）
        commit();
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
      if (e.key === "Enter" || e.key === "Escape" || (e.key === "g" && e.ctrlKey && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation(); // window の Escape ハンドラに伝播させない（選択を維持）
        commit();
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
