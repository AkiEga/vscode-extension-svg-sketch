import type { DrawStyle, Shape } from "../shared";

export const DEFAULT_DRAW_STYLE: DrawStyle = {
  stroke: "#000000",
  fill: "#ffffff",
  lineWidth: 2,
};

function isColorToken(value: string | undefined): value is string {
  if (!value) { return false; }
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v);
}

function isVisibleColorToken(value: string | undefined): value is string {
  if (!isColorToken(value)) { return false; }
  const lowered = value.toLowerCase();
  return lowered !== "none" && lowered !== "transparent";
}

export function resolveDrawStyleFromShapes(shapes: Shape[]): DrawStyle {
  let stroke = DEFAULT_DRAW_STYLE.stroke;
  let fill = DEFAULT_DRAW_STYLE.fill;
  let lineWidth = DEFAULT_DRAW_STYLE.lineWidth;

  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (lineWidth === DEFAULT_DRAW_STYLE.lineWidth && Number.isFinite(s.lineWidth)) {
      lineWidth = Math.max(0, s.lineWidth);
    }
    if (stroke === DEFAULT_DRAW_STYLE.stroke && isVisibleColorToken(s.stroke)) {
      stroke = s.stroke;
    }
    if (fill === DEFAULT_DRAW_STYLE.fill && isVisibleColorToken(s.fill)) {
      fill = s.fill;
    }
    if (
      lineWidth !== DEFAULT_DRAW_STYLE.lineWidth &&
      stroke !== DEFAULT_DRAW_STYLE.stroke &&
      fill !== DEFAULT_DRAW_STYLE.fill
    ) {
      break;
    }
  }

  return { stroke, fill, lineWidth };
}
