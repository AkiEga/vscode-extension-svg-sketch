# SVG Sketch

English | [日本語](./README.ja.md)

SVG Sketch is a VS Code extension that lets you create and edit SVG diagrams with a canvas-based editor.

## Features

- Canvas-based custom editor for `.svg` files
- 7 tools: Select, Rectangle, Ellipse, Arrow, Text, Bubble, Table
- Insert/edit labels for selected shapes (`F2`)
- Save/overwrite SVG directly from the editor
- Re-edit existing SVG files (diagram data is embedded in `data-diagram`)
- Undo/Redo and keyboard shortcuts
- Copy/paste selected shapes (`Ctrl+C` / `Ctrl+V`)
- Paste screenshots/images from clipboard directly onto canvas (`Ctrl+V`)
- Grid snap toggle (`S`)
- Group/Ungroup selected shapes (`Ctrl+G` / `Ctrl+Shift+G`)
- Borderless mode (`No border` sets width to `0`)
- Diagram template save/insert/delete workflow
- Save templates as standalone SVG files

## Usage

### Create a new SVG

1. Open the Command Palette.
2. Run `SVG Sketch: New SVG`.
3. Draw on the canvas with the toolbar tools.
4. Click `Save` to write the SVG content.

### Create SVG File during Markdown editing

1. Open the Command Palette.
2. Run `SVG Sketch: Create SVG File`.
3. Enter a file name (without extension).
4. An SVG file is created in the configured output directory and opened in the editor.
5. **When executed from a Markdown file, an image link is automatically inserted at the cursor position.**
6. Draw the diagram, then click `Save`.

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
| `B` | Bubble tool |
| `G` | Table tool |
| `F2` | Edit label/text for selected shape |
| `S` | Toggle grid snap |
| `Ctrl+G` | Group selected shapes |
| `Ctrl+Shift+G` | Ungroup selected shapes |
| `Ctrl+C` | Copy selected shapes |
| `Ctrl+V` | Paste shapes or clipboard image |
| `Delete` / `Backspace` | Delete selected shape |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |

## Settings

| Setting | Description | Default |
|---|---|---|
| `svg-sketch.svgOutputDir` | Directory to save SVG files when using the 'Create SVG File' command (relative to workspace root or current file directory) | `images` |
| `svg-sketch.templateDir` | Directory for stored diagram templates (relative to workspace root). Leave empty to disable template features | `""` (disabled) |
| `svg-sketch.defaultStroke` | Default stroke color for new shapes (hex) | `#000000` |
| `svg-sketch.defaultFill` | Default fill color for new shapes (hex) | `#ffffff` |
| `svg-sketch.defaultLineWidth` | Default line width for new shapes | `2` |
| `svg-sketch.screenshotPasteEnabled` | Enable pasting screenshot/image from clipboard into canvas | `true` |
| `svg-sketch.screenshotPasteMaxWidth` | Max width of pasted screenshot/image | `1024` |

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
