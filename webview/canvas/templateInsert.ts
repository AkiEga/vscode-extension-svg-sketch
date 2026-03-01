import type { Shape, Bounds } from "../shared";

export type { Bounds };

export function getShapesBounds(shapes: Shape[]): Bounds | undefined {
  if (shapes.length === 0) {
    return undefined;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const shape of shapes) {
    const b = shape.getBounds();
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }

  return { minX, minY, maxX, maxY };
}

export function prepareTemplateInsertion(existingShapes: Shape[], incomingShapes: Shape[]): {
  shapes: Shape[];
  insertedIds: string[];
  dx: number;
  dy: number;
} {
  if (incomingShapes.length === 0) {
    return { shapes: [], insertedIds: [], dx: 0, dy: 0 };
  }

  const existingBounds = getShapesBounds(existingShapes);
  const incomingBounds = getShapesBounds(incomingShapes);
  if (!incomingBounds) {
    return { shapes: [], insertedIds: [], dx: 0, dy: 0 };
  }

  const { dx, dy } = chooseInsertionOffset(existingBounds, incomingBounds);
  const shifted = incomingShapes.map((shape) => {
    const s = shape.clone();
    s.translate(dx, dy);
    return s;
  });
  const { shapes, insertedIds } = withUniqueIds(shifted, new Set(existingShapes.map((s) => s.id)));
  return { shapes, insertedIds, dx, dy };
}

function chooseInsertionOffset(existing: Bounds | undefined, incoming: Bounds): { dx: number; dy: number } {
  if (!existing) {
    return { dx: 0, dy: 0 };
  }

  const step = 36;
  let dx = step;
  let dy = step;

  for (let i = 0; i < 20; i++) {
    const shifted: Bounds = {
      minX: incoming.minX + dx,
      minY: incoming.minY + dy,
      maxX: incoming.maxX + dx,
      maxY: incoming.maxY + dy,
    };
    if (!intersects(existing, shifted)) {
      return { dx, dy };
    }
    dx += step;
    dy += step;
  }

  return { dx, dy };
}

function intersects(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function withUniqueIds(shapes: Shape[], existingIds: Set<string>): { shapes: Shape[]; insertedIds: string[] } {
  const seed = `tpl_${Date.now().toString(36)}`;
  const insertedIds: string[] = [];
  const result: Shape[] = [];

  for (let i = 0; i < shapes.length; i++) {
    let id = `${seed}_${i + 1}`;
    let suffix = 1;
    while (existingIds.has(id)) {
      id = `${seed}_${i + 1}_${suffix++}`;
    }

    existingIds.add(id);
    insertedIds.push(id);
    result.push(shapes[i].clone(id));
  }

  return { shapes: result, insertedIds };
}

function getShapeBounds(shape: Shape): Bounds {
  switch (shape.type) {
    case "rect":
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.width,
        maxY: shape.y + shape.height,
      };
    case "ellipse":
      return {
        minX: shape.cx - shape.rx,
        minY: shape.cy - shape.ry,
        maxX: shape.cx + shape.rx,
        maxY: shape.cy + shape.ry,
      };
    case "arrow":
      return {
        minX: Math.min(shape.x1, shape.x2),
        minY: Math.min(shape.y1, shape.y2),
        maxX: Math.max(shape.x1, shape.x2),
        maxY: Math.max(shape.y1, shape.y2),
      };
    case "text": {
      const width = shape.text.length * shape.fontSize * 0.6;
      return {
        minX: shape.x,
        minY: shape.y - shape.fontSize,
        maxX: shape.x + width,
        maxY: shape.y,
      };
    }
    case "table":
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.width,
        maxY: shape.y + shape.height,
      };
  }
}

function translateShape(shape: Shape, dx: number, dy: number): Shape {
  switch (shape.type) {
    case "rect":
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case "ellipse":
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case "arrow":
      return {
        ...shape,
        x1: shape.x1 + dx,
        y1: shape.y1 + dy,
        x2: shape.x2 + dx,
        y2: shape.y2 + dy,
      };
    case "text":
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case "table":
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
  }
}
