import { AsciiBuffer, type CursorPos, type SelectionRange } from "./AsciiBuffer";
import { AsciiRenderer, type RenderMetrics } from "./AsciiRenderer";
import { autoAdjustBox, findContainingBox, toggleBox } from "./BoxDrawing";

interface AsciiEditorElements {
  saveButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  status: HTMLElement;
}

interface AsciiEditorCallbacks {
  onSave: (content: string, closeAfterSave: boolean) => void;
  onClose: () => void;
}

interface Snapshot {
  cells: string[][];
  cursor: CursorPos;
  selection: SelectionRange | null;
  width: number;
  height: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export class AsciiEditor {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: AsciiRenderer;
  private readonly elements: AsciiEditorElements;
  private readonly callbacks: AsciiEditorCallbacks;
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private buffer: AsciiBuffer;
  private clipboard = "";
  private dragAnchor: CursorPos | null = null;
  private prefixPending = false;
  private metrics: RenderMetrics | null = null;

  constructor(canvas: HTMLCanvasElement, elements: AsciiEditorElements, callbacks: AsciiEditorCallbacks, width = 80, height = 20) {
    this.canvas = canvas;
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.ctx = context;
    this.renderer = new AsciiRenderer();
    this.elements = elements;
    this.callbacks = callbacks;
    this.buffer = new AsciiBuffer(width, height);
    this.canvas.tabIndex = 0;
    this.bindEvents();
    this.render();
  }

  public load(content: string): void {
    this.buffer = AsciiBuffer.fromText(content);
    this.clearHistory();
    this.render();
  }

  public getContent(): string {
    return this.buffer.toText();
  }

  private bindEvents(): void {
    this.canvas.addEventListener("mousedown", (event) => this.handleMouseDown(event));
    this.canvas.addEventListener("mousemove", (event) => this.handleMouseMove(event));
    window.addEventListener("mouseup", () => this.handleMouseUp());
    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
    this.elements.saveButton.addEventListener("click", () => this.save(false));
    this.elements.closeButton.addEventListener("click", () => this.callbacks.onClose());
    window.addEventListener("resize", () => this.render());
  }

  private clearHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private pushUndo(): void {
    this.undoStack.push(this.buffer.getSnapshot());
    if (this.undoStack.length > 100) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  private undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      return;
    }
    this.redoStack.push(this.buffer.getSnapshot());
    this.buffer.restoreSnapshot(snapshot);
    this.render();
  }

  private redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) {
      return;
    }
    this.undoStack.push(this.buffer.getSnapshot());
    this.buffer.restoreSnapshot(snapshot);
    this.render();
  }

  private render(): void {
    this.metrics = this.renderer.render(this.ctx, this.buffer, this.buffer.cursor, this.buffer.selection);
    this.updateStatus();
  }

  private updateStatus(): void {
    this.elements.status.textContent = `Row ${this.buffer.cursor.row + 1}, Col ${this.buffer.cursor.col + 1} | ${this.buffer.width}x${this.buffer.height}`;
  }

  private save(closeAfterSave: boolean): void {
    this.callbacks.onSave(this.getContent(), closeAfterSave);
  }

  private cellFromMouse(event: MouseEvent): CursorPos {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const metrics = this.metrics ?? this.renderer.getMetrics(this.ctx);
    return this.renderer.screenToCell(x, y, metrics);
  }

  private handleMouseDown(event: MouseEvent): void {
    this.canvas.focus();
    const cell = this.cellFromMouse(event);
    this.buffer.cursor = cell;
    this.dragAnchor = cell;
    this.buffer.setSelection({ start: cell, end: cell });
    this.render();
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.dragAnchor) {
      return;
    }
    const cell = this.cellFromMouse(event);
    this.buffer.cursor = cell;
    this.buffer.setSelection({ start: this.dragAnchor, end: cell });
    this.render();
  }

  private handleMouseUp(): void {
    this.dragAnchor = null;
    this.render();
  }

  private copySelection(): void {
    if (!this.buffer.hasSelection()) {
      return;
    }
    this.clipboard = this.buffer.getSelectedText();
  }

  private pasteClipboard(): void {
    if (!this.clipboard) {
      return;
    }
    this.pushUndo();
    if (this.buffer.hasSelection()) {
      this.buffer.killSelection();
    }
    this.buffer.paste(this.clipboard);
    this.adjustBoxIfNeeded();
    this.render();
  }

  private adjustBoxIfNeeded(): void {
    const box = findContainingBox(this.buffer, this.buffer.cursor);
    if (box) {
      autoAdjustBox(this.buffer, box);
    }
  }

  private runPrefixCommand(event: KeyboardEvent): boolean {
    if (!this.prefixPending || !event.ctrlKey) {
      return false;
    }
    this.prefixPending = false;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      this.save(false);
      return true;
    }
    if (key === "r") {
      if (!this.buffer.selection) {
        return true;
      }
      event.preventDefault();
      this.pushUndo();
      const result = toggleBox(this.buffer, this.buffer.selection);
      if (result) {
        this.buffer.setSelection({
          start: { row: result.top + 1, col: result.left + 1 },
          end: { row: result.bottom - 1, col: result.right - 1 },
        });
      }
      this.render();
      return true;
    }
    return false;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || isEditableTarget(event.target)) {
      return;
    }
    if (this.runPrefixCommand(event)) {
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "x") {
      event.preventDefault();
      this.prefixPending = true;
      return;
    }
    if (this.prefixPending) {
      this.prefixPending = false;
    }

    const lowerKey = event.key.toLowerCase();
    if (event.ctrlKey) {
      switch (lowerKey) {
        case "b":
          event.preventDefault();
          this.buffer.moveCursor("left");
          this.buffer.clearSelection();
          this.render();
          return;
        case "f":
          event.preventDefault();
          this.buffer.moveCursor("right");
          this.buffer.clearSelection();
          this.render();
          return;
        case "p":
          event.preventDefault();
          this.buffer.moveCursor("up");
          this.buffer.clearSelection();
          this.render();
          return;
        case "n":
          event.preventDefault();
          this.buffer.moveCursor("down");
          this.buffer.clearSelection();
          this.render();
          return;
        case "a":
          event.preventDefault();
          this.buffer.moveCursor("home");
          this.buffer.clearSelection();
          this.render();
          return;
        case "e":
          event.preventDefault();
          this.buffer.moveCursor("end");
          this.buffer.clearSelection();
          this.render();
          return;
        case "d":
          event.preventDefault();
          this.pushUndo();
          this.buffer.deleteForward();
          this.adjustBoxIfNeeded();
          this.render();
          return;
        case "h":
          event.preventDefault();
          this.pushUndo();
          this.buffer.deleteBackward();
          this.adjustBoxIfNeeded();
          this.render();
          return;
        case "k":
          event.preventDefault();
          this.pushUndo();
          this.clipboard = this.buffer.killLine();
          this.adjustBoxIfNeeded();
          this.render();
          return;
        case "w":
          event.preventDefault();
          if (this.buffer.hasSelection()) {
            this.pushUndo();
            this.clipboard = this.buffer.killSelection();
            this.adjustBoxIfNeeded();
            this.render();
          }
          return;
        case "c":
          event.preventDefault();
          this.copySelection();
          return;
        case "v":
          event.preventDefault();
          this.pasteClipboard();
          return;
        case "y":
          event.preventDefault();
          this.redo();
          return;
        case "z":
          event.preventDefault();
          this.undo();
          return;
      }
    }

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        this.buffer.moveCursor("left");
        this.buffer.clearSelection();
        this.render();
        return;
      case "ArrowRight":
        event.preventDefault();
        this.buffer.moveCursor("right");
        this.buffer.clearSelection();
        this.render();
        return;
      case "ArrowUp":
        event.preventDefault();
        this.buffer.moveCursor("up");
        this.buffer.clearSelection();
        this.render();
        return;
      case "ArrowDown":
        event.preventDefault();
        this.buffer.moveCursor("down");
        this.buffer.clearSelection();
        this.render();
        return;
      case "Home":
        event.preventDefault();
        this.buffer.moveCursor("home");
        this.buffer.clearSelection();
        this.render();
        return;
      case "End":
        event.preventDefault();
        this.buffer.moveCursor("end");
        this.buffer.clearSelection();
        this.render();
        return;
      case "Backspace":
        event.preventDefault();
        this.pushUndo();
        this.buffer.deleteBackward();
        this.adjustBoxIfNeeded();
        this.render();
        return;
      case "Delete":
        event.preventDefault();
        this.pushUndo();
        this.buffer.deleteForward();
        this.adjustBoxIfNeeded();
        this.render();
        return;
    }

    if (event.key.length === 1 && !event.altKey && !event.metaKey) {
      event.preventDefault();
      this.pushUndo();
      if (this.buffer.hasSelection()) {
        this.buffer.killSelection();
      }
      this.buffer.insertChar(event.key);
      this.adjustBoxIfNeeded();
      this.render();
    }
  }
}
