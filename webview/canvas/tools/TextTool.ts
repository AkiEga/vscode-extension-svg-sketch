import type { Point, DrawStyle, Tool } from "../../shared";
import { TextShape, nextId } from "../../shared";
import type { Shape } from "../../shared";
import { DEFAULT_DRAW_STYLE } from "../drawStyle";

export type TextInputRequest = {
  pt: Point;
  style: DrawStyle;
  resolve: (text: string | null) => void;
};

export class TextTool implements Tool {
  private clickPt: Point | undefined;
  private style: DrawStyle = { ...DEFAULT_DRAW_STYLE };
  private _onTextRequest: ((req: TextInputRequest) => void) | undefined;

  set onTextRequest(cb: (req: TextInputRequest) => void) {
    this._onTextRequest = cb;
  }

  onMouseDown(pt: Point, style: DrawStyle): void {
    this.clickPt = pt;
    this.style = { ...style };
  }

  onMouseMove(_pt: Point): void {}

  onMouseUp(_pt: Point): Shape | undefined {
    if (!this.clickPt) { return undefined; }
    const pt = this.clickPt;
    const style = { ...this.style };
    this.clickPt = undefined;

    if (this._onTextRequest) {
      this._onTextRequest({
        pt,
        style,
        resolve: () => {},  // placeholder; CanvasEditor handles shape creation
      });
    }
    return undefined;
  }

  createShape(pt: Point, style: DrawStyle, text: string): TextShape {
    return new TextShape({
      id: nextId(),
      x: pt.x,
      y: pt.y,
      text,
      fontSize: 16,
      stroke: style.stroke,
      fill: style.stroke, // text uses stroke color as fill
      lineWidth: style.lineWidth,
    });
  }

  getPreview(): Shape | undefined {
    return undefined;
  }
}
