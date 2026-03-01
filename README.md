# SVG Sketch

English | [日本語](./README.ja.md)

SVG Sketch is a VS Code extension that lets you create and edit SVG diagrams with a canvas-based editor.

## Features

- Canvas-based custom editor for `.svg` files
- 6 drawing tools: Select, Rectangle, Ellipse, Arrow, Text, Table
- Save/overwrite SVG directly from the editor
- Re-edit existing SVG files (diagram data is embedded in `data-diagram`)
- Undo/Redo and keyboard shortcuts
- Diagram template save/insert/delete workflow

## Usage

### Create a new SVG

1. Open the Command Palette.
2. Run `SVG Sketch: New SVG`.
3. Draw on the canvas with the toolbar tools.
4. Click `Save` to write the SVG content.

### Edit an existing SVG

- Open a `.svg` file in VS Code.
- It is opened with the `SVG Sketch Editor` custom editor (default for `*.svg`).

### Keyboard shortcuts

| Key | Action |
|---|---|
| `V` | Select tool |
| `R` | Rectangle tool |
| `E` | Ellipse tool |
| `A` | Arrow tool |
| `T` | Text tool |
| `G` | Table tool |
| `Delete` / `Backspace` | Delete selected shape |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |

## Settings

| Setting | Description | Default |
|---|---|---|
| `svg-sketch.templateDir` | Directory for stored diagram templates (relative to workspace root) | `.svg-sketch/templates` |

## Development

```bash
npm install
node esbuild.mjs --development
node esbuild.mjs --watch
node esbuild.mjs --production
npx vitest run
```

## License

MIT
