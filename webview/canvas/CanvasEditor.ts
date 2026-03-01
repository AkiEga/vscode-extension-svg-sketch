import type { Shape, ToolType, DrawStyle, Point, Tool } from "../shared";
import { RectTool } from "./tools/RectTool";
import { EllipseTool } from "./tools/EllipseTool";
import { ArrowTool } from "./tools/ArrowTool";
import { TextTool } from "./tools/TextTool";
import { SelectTool } from "./tools/SelectTool";
import { renderShapes } from "./render";

export class CanvasEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shapes: Shape[] = [];
  private currentToolType: ToolType = "rect";
  private currentTool: Tool;
  private style: DrawStyle = { stroke: "#000000", fill: "#ffffff", lineWidth: 2 };
  private isDragging = false;
  private selectedId: string | undefined;
  private selectTool: SelectTool;

  // Undo/Redo
  private undoStack: Shape[][] = [];
  private redoStack: Shape[][] = [];

  private onSelectionChange: (id: string | undefined) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.selectTool = new SelectTool(this.shapes, (id) => {
      this.selectedId = id;
      this.onSelectionChange(id);
    });
    this.currentTool = new RectTool();
    this.setupEvents();
    this.resize();
    this.render();
  }

  setTool(toolType: ToolType): void {
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
      case "select":
        this.currentTool = this.selectTool;
        break;
    }
    this.canvas.className = toolType === "select" ? "tool-select" : "";
  }

  setStyle(style: Partial<DrawStyle>): void {
    Object.assign(this.style, style);
  }

  setOnSelectionChange(cb: (id: string | undefined) => void): void {
    this.onSelectionChange = cb;
  }

  getShapes(): Shape[] {
    return [...this.shapes];
  }

  setShapes(shapes: Shape[]): void {
    this.shapes.length = 0;
    this.shapes.push(...shapes);
    this.selectTool = new SelectTool(this.shapes, (id) => {
      this.selectedId = id;
      this.onSelectionChange(id);
    });
    if (this.currentToolType === "select") {
      this.currentTool = this.selectTool;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  deleteSelected(): void {
    if (!this.selectedId) { return; }
    this.pushUndo();
    this.shapes.splice(
      this.shapes.findIndex((s) => s.id === this.selectedId),
      1,
    );
    this.selectedId = undefined;
    this.onSelectionChange(undefined);
    this.render();
  }

  undo(): void {
    if (this.undoStack.length === 0) { return; }
    this.redoStack.push(this.cloneShapes());
    const prev = this.undoStack.pop()!;
    this.shapes.length = 0;
    this.shapes.push(...prev);
    this.render();
  }

  redo(): void {
    if (this.redoStack.length === 0) { return; }
    this.undoStack.push(this.cloneShapes());
    const next = this.redoStack.pop()!;
    this.shapes.length = 0;
    this.shapes.push(...next);
    this.render();
  }

  getCanvasSize(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  private pushUndo(): void {
    this.undoStack.push(this.cloneShapes());
    this.redoStack = [];
  }

  private cloneShapes(): Shape[] {
    return JSON.parse(JSON.stringify(this.shapes));
  }

  private setupEvents(): void {
    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.canvas.addEventListener("mouseup", (e) => this.onMouseUp(e));

    window.addEventListener("resize", () => {
      this.resize();
      this.render();
    });

    window.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedId) {
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
    });
  }

  private getPoint(e: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.currentTool.onMouseDown(this.getPoint(e), this.style);
    this.render();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) { return; }
    this.currentTool.onMouseMove(this.getPoint(e));
    this.render();
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.isDragging) { return; }
    this.isDragging = false;
    const shape = this.currentTool.onMouseUp(this.getPoint(e));
    if (shape) {
      this.pushUndo();
      this.shapes.push(shape);
    }
    this.render();
  }

  resize(): void {
    const container = this.canvas.parentElement!;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
  }

  render(): void {
    const preview = this.currentTool.getPreview();
    renderShapes(this.ctx, this.shapes, preview, this.selectedId);
  }

  private showTextInput(pt: Point, style: DrawStyle): void {
    const container = this.canvas.parentElement!;
    const rect = this.canvas.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    const input = document.createElement("input");
    input.type = "text";
    input.style.position = "absolute";
    input.style.left = `${rect.left - contRect.left + pt.x}px`;
    input.style.top = `${rect.top - contRect.top + pt.y - 16}px`;
    input.style.fontSize = "16px";
    input.style.fontFamily = "sans-serif";
    input.style.border = "1px solid #007acc";
    input.style.outline = "none";
    input.style.padding = "2px 4px";
    input.style.background = "#fff";
    input.style.color = style.stroke;
    input.style.minWidth = "80px";
    input.style.zIndex = "10";
    container.appendChild(input);
    input.focus();

    const commit = () => {
      const text = input.value.trim();
      if (text) {
        const textTool = new TextTool();
        const shape = textTool.createShape(pt, style, text);
        this.pushUndo();
        this.shapes.push(shape);
        this.render();
      }
      cleanup();
    };

    const cleanup = () => {
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
  }
}
