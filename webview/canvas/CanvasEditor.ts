import type { Shape, ToolType, DrawStyle, Point, Tool } from "../shared";
import { hitTest, TextShape, TableShape, RectShape, EllipseShape, ArrowShape, BubbleShape, ImageShape, nextId } from "../shared";
import { RectTool } from "./tools/RectTool";
import { EllipseTool } from "./tools/EllipseTool";
import { ArrowTool } from "./tools/ArrowTool";
import { BubbleTool } from "./tools/BubbleTool";
import { TextTool } from "./tools/TextTool";
import { TableTool, type TableConfigRequest } from "./tools/TableTool";
import { SelectTool, getShapeHandles } from "./tools/SelectTool";
import type { DragHandleId } from "./tools/SelectTool";
import { renderShapes } from "./render";
import { prepareTemplateInsertion } from "./templateInsert";
import { DEFAULT_DRAW_STYLE } from "./drawStyle";

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
  if (shape instanceof RectShape || shape instanceof BubbleShape || shape instanceof TableShape || shape instanceof ImageShape) {
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

/**
 * vimium 風のヒントラベルを n 個生成する。
 * 1文字 → 2文字の順で、home-row 優先の文字順を使用する。
 */
function generateHintLabels(n: number): string[] {
  const chars = "asdfjkl;ghqwertyuiopzxcvbnm";
  const labels: string[] = [];
  for (let i = 0; i < chars.length && labels.length < n; i++) {
    labels.push(chars[i]);
  }
  for (let i = 0; i < chars.length && labels.length < n; i++) {
    for (let j = 0; j < chars.length && labels.length < n; j++) {
      labels.push(chars[i] + chars[j]);
    }
  }
  return labels.slice(0, n);
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

  // Hint mode (vimium-like 'f' key shape selection)
  private hintMode = false;
  private hintMap: Map<string, string> = new Map(); // label -> shapeId
  private hintInput = "";

  // Handle hint mode (second 'f' press: select a handle of the selected shape)
  private handleHintMode = false;
  private handleHintMap: Map<string, DragHandleId> = new Map(); // key char -> handleId
  private activeHandleForKbd: DragHandleId | undefined;

  // Object inserting mode ('i' key: Idle → tool selection → shape placed)
  private objectInsertingMode = false;

  // Help overlay
  private helpOverlayEl: HTMLElement | undefined;

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
      // --- ハンドルヒントモード中の処理 ---
      if (this.handleHintMode) {
        if (e.key === "Escape") {
          e.preventDefault();
          this.exitHandleHintMode();
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          const handleId = this.handleHintMap.get(e.key.toLowerCase());
          if (handleId) {
            this.activeHandleForKbd = handleId;
          }
          this.exitHandleHintMode();
          return;
        }
        return; // ハンドルヒントモード中は他のキーを無視
      }

      // --- ヒントモード中の処理 ---
      if (this.hintMode) {
        if (e.key === "Escape") {
          e.preventDefault();
          this.exitHintMode();
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.hintInput += e.key.toLowerCase();
          const shapeId = this.hintMap.get(this.hintInput);
          if (shapeId) {
            this.selectedIds = new Set([shapeId]);
            this.onSelectionChange(new Set(this.selectedIds));
            this.exitHintMode();
            return;
          }
          // 候補が残っているか確認
          const hasPrefix = [...this.hintMap.keys()].some((label) => label.startsWith(this.hintInput));
          if (!hasPrefix) {
            this.exitHintMode();
            return;
          }
          this.render();
          return;
        }
        return; // ヒントモード中は他のキーを無視
      }

      // --- ObjectInserting モード中の処理 ---
      if (this.objectInsertingMode) {
        if (e.key === "Escape") {
          e.preventDefault();
          this.exitObjectInsertingMode();
          return;
        }
        // ツールキー (t/r/e/a/b/g/v/s) は main.ts が処理するのでスルー
        // その他の文字キーは無視
        const toolKeys = ["t", "r", "e", "a", "b", "g", "v", "s"];
        if (!toolKeys.includes(e.key.toLowerCase())) {
          if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
          }
          return;
        }
        return; // ツールキーは main.ts に委ねてここでは何もしない
      }

      // --- `f` キー: 図形選択済み→ハンドルヒント、未選択→図形ヒント ---
      if (e.key === "f" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          if (this.selectedIds.size === 1) {
            // 図形が1つ選択中 → ハンドルヒントモード
            this.enterHandleHintMode();
          } else if (this.shapes.length > 0) {
            // 未選択 or 複数選択 → 図形ヒントモード
            this.enterHintMode();
          }
          return;
        }
      }

      // --- `i` キー: Idle 状態でオブジェクト挿入モードに入る ---
      if (e.key === "i" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          if (this.selectedIds.size === 0) {
            e.preventDefault();
            this.enterObjectInsertingMode();
            return;
          }
        }
      }

      // --- `?` キーでヘルプオーバーレイ表示/非表示 ---
      if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          this.toggleHelpOverlay();
          return;
        }
      }

      // --- `Escape` キー ---
      if (e.key === "Escape") {
        if (this.helpOverlayEl) { this.hideHelpOverlay(); return; }
        if (this.handleHintMode) { this.exitHandleHintMode(); return; }
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
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          this.deleteSelected();
        }
      }

      // --- 矢印キー / hjkl / Ctrl+n,p で図形 or ハンドル移動 ---
      const isArrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key);
      const isVimMove = ["h", "j", "k", "l"].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey &&
        (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA";
      const isInputFocused = (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA";
      // Ctrl+n (下移動) / Ctrl+p (上移動): INPUT 外のみ
      const isEmacsMove = e.ctrlKey && !e.altKey && !e.metaKey && !isInputFocused &&
        (e.key === "n" || e.key === "p");

      // --- INPUT 内 Emacs キーバインド ---
      if (isInputFocused) {
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
      }

      const hasMoveTarget = this.activeHandleForKbd
        ? this.selectedIds.size === 1
        : this.selectedIds.size > 0;
      if ((isArrow && !isInputFocused || isVimMove || isEmacsMove) && hasMoveTarget) {
        e.preventDefault();
        const step = e.ctrlKey && !isEmacsMove ? 1 : 20;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft"  || e.key === "h") { dx = -step; }
        if (e.key === "ArrowRight" || e.key === "l") { dx =  step; }
        if (e.key === "ArrowUp"    || e.key === "k") { dy = -step; }
        if (e.key === "ArrowDown"  || e.key === "j") { dy =  step; }
        if (e.key === "n") { dy =  step; }  // Ctrl+n
        if (e.key === "p") { dy = -step; }  // Ctrl+p
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
            } else if (shape instanceof RectShape || shape instanceof BubbleShape || shape instanceof TextShape || shape instanceof TableShape || shape instanceof ImageShape) {
              shape.x += dx; shape.y += dy;
            }
          }
        }
        this.onChange();
        this.render();
      }
      if (e.ctrlKey && e.key === "z") {
        if (isInputFocused) { return; } // INPUT 内の Undo はブラウザに委ねる
        e.preventDefault();
        this.undo();
      }
      if (e.ctrlKey && e.key === "y") {
        if (isInputFocused) { return; }
        e.preventDefault();
        this.redo();
      }
      if (e.ctrlKey && e.key === "c") {
        if (isInputFocused) { return; } // INPUT 内のコピーはブラウザに委ねる
        e.preventDefault();
        this.copySelected();
      }
      if (e.ctrlKey && e.key === "v") {
        if (isInputFocused) { return; }
        e.preventDefault();
        this.paste();
      }
      if (e.key === "F2") {
        e.preventDefault();
        this.editSelectedShapeLabel();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "g" && !e.shiftKey) {
        if (isInputFocused) { return; }
        e.preventDefault();
        this.groupSelected();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "g" && e.shiftKey) {
        if (isInputFocused) { return; }
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
      // 作成した図形を自動選択
      this.selectedIds = new Set([shape.id]);
      this.onSelectionChange(new Set(this.selectedIds));
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
    if (this.hintMode) { this.drawHintLabels(); }
    if (this.handleHintMode) { this.drawHandleHints(); }
    if (this.activeHandleForKbd && this.selectedIds.size === 1) { this.drawActiveHandleIndicator(); }
    if (this.objectInsertingMode) { this.drawInsertIndicator(); }
  }

  private enterHintMode(): void {
    this.hintMode = true;
    this.hintInput = "";
    this.hintMap = new Map();
    const labels = generateHintLabels(this.shapes.length);
    for (let i = 0; i < this.shapes.length; i++) {
      this.hintMap.set(labels[i], this.shapes[i].id);
    }
    this.render();
  }

  private exitHintMode(): void {
    this.hintMode = false;
    this.hintInput = "";
    this.hintMap = new Map();
    this.render();
  }

  private enterHandleHintMode(): void {
    if (this.selectedIds.size !== 1) { return; }
    const shapeId = [...this.selectedIds][0];
    const shape = this.shapes.find((s) => s.id === shapeId);
    if (!shape) { return; }
    this.handleHintMap = new Map();
    if (shape instanceof ArrowShape) {
      this.handleHintMap.set("s", "start");
      this.handleHintMap.set("e", "end");
    } else {
      // 数字キー: 1=tl, 2=tr, 3=bl, 4=br (位置イメージ)
      this.handleHintMap.set("1", "tl");
      this.handleHintMap.set("2", "tr");
      this.handleHintMap.set("3", "bl");
      this.handleHintMap.set("4", "br");
    }
    this.handleHintMode = true;
    this.render();
  }

  private exitHandleHintMode(): void {
    this.handleHintMode = false;
    this.handleHintMap = new Map();
    this.render();
  }

  private enterObjectInsertingMode(): void {
    this.objectInsertingMode = true;
    this.render();
  }

  exitObjectInsertingMode(): void {
    this.objectInsertingMode = false;
    this.render();
  }

  isObjectInsertingMode(): boolean {
    return this.objectInsertingMode;
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
      ["h / ←",      "左へ移動"],
      ["j / ↓",      "下へ移動"],
      ["k / ↑",      "上へ移動"],
      ["l / →",      "右へ移動"],
      ["Ctrl + ←↑↓→","1px ずつ微調整"],
      ["Escape",     "ハンドル解除 → 選択解除"],
      ["Del / BS",   "図形を削除"],
      ["F2",         "ラベル編集"],
      ["Ctrl+Z",     "元に戻す"],
      ["Ctrl+Y",     "やり直す"],
      ["Ctrl+C",     "コピー"],
      ["Ctrl+V",     "貼り付け"],
      ["Ctrl+G",     "グループ化"],
      ["Ctrl+Shift+G","グループ解除"],
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

    for (const [label, shapeId] of this.hintMap) {
      // 既入力部分が一致しない候補はスキップ
      if (!label.startsWith(this.hintInput)) { continue; }

      const shape = this.shapes.find((s) => s.id === shapeId);
      if (!shape) { continue; }

      const b = shape.getBounds();
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;

      const fullW = ctx.measureText(label).width;
      const typedW = this.hintInput.length > 0 ? ctx.measureText(this.hintInput).width : 0;
      const remaining = label.slice(this.hintInput.length);

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
      if (this.hintInput.length > 0) {
        ctx.fillStyle = "#888";
        ctx.fillText(this.hintInput, textX, textY);
      }

      // 未入力部分（黒）
      ctx.fillStyle = "#000";
      ctx.fillText(remaining, textX + typedW, textY);
    }

    ctx.restore();
  }

  private drawInsertIndicator(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const text = "-- INSERT --";
    const fontSize = 13;
    const pad = 6;
    ctx.font = `bold ${fontSize}px monospace`;
    const tw = ctx.measureText(text).width;
    const x = logicalW / 2 - tw / 2 - pad;
    const y = logicalH - fontSize - pad * 3;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, tw + pad * 2, fontSize + pad * 2, 3); }
    else { ctx.rect(x, y, tw + pad * 2, fontSize + pad * 2); }
    ctx.fill();
    ctx.fillStyle = "#7fdbca";
    ctx.fillText(text, x + pad, y + fontSize + pad / 2);
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
    };

    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Enter / Escape で確定、素の Enter はブラウザに委ねて改行挿入
      if ((e.key === "Enter" && e.ctrlKey) || e.key === "Escape") {
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
      if (e.key === "Enter" || e.key === "Escape") {
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
      if (e.key === "Enter" || e.key === "Escape") {
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
