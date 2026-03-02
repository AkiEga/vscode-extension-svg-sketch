#!/usr/bin/env node
/**
 * svg-sketch-cli — 簡単な SVG を生成する CLI ツール
 *
 * Usage:
 *   npx ts-node cli/svg-sketch-cli.ts rect 10 10 200 100 -o out.svg
 *   npx ts-node cli/svg-sketch-cli.ts ellipse 100 100 80 50
 *   npx ts-node cli/svg-sketch-cli.ts text 20 40 "Hello World"
 *   npx ts-node cli/svg-sketch-cli.ts json shapes.json -o diagram.svg
 *   npx ts-node cli/svg-sketch-cli.ts parse diagram.svg  (extract shapes JSON)
 */

import * as fs from "fs";
import * as path from "path";
import {
  RectShape,
  EllipseShape,
  ArrowShape,
  TextShape,
  type Shape,
  type ShapeJSON,
  reviveShapes,
} from "../src/types";
import { shapesToSvg, parseDiagramData } from "../src/svgExporter";

// --- helpers ---
let _idCounter = 0;
function nextId(): string {
  return `cli-${++_idCounter}`;
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("-")) {
      flags[arg] = argv[i + 1] ?? "";
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function writeOutput(svg: string, outPath: string | undefined): void {
  if (outPath) {
    const resolved = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, svg, "utf-8");
    console.log(`Written: ${resolved}`);
  } else {
    process.stdout.write(svg + "\n");
  }
}

// --- subcommands ---

function cmdRect(args: string[], flags: Record<string, string>): void {
  const [xStr, yStr, wStr, hStr] = args;
  const x = Number(xStr ?? 0);
  const y = Number(yStr ?? 0);
  const width = Number(wStr ?? 100);
  const height = Number(hStr ?? 60);
  const stroke = flags["--stroke"] ?? flags["-s"] ?? "#000000";
  const fill = flags["--fill"] ?? flags["-f"] ?? "#ffffff";
  const lineWidth = Number(flags["--line-width"] ?? flags["-lw"] ?? 2);
  const label = flags["--label"] ?? flags["-l"] ?? undefined;

  const shape = new RectShape({
    id: nextId(), x, y, width, height, stroke, fill, lineWidth, label,
  });
  const svgWidth = Number(flags["--width"] ?? flags["-W"] ?? 800);
  const svgHeight = Number(flags["--height"] ?? flags["-H"] ?? 600);
  writeOutput(shapesToSvg([shape], svgWidth, svgHeight), flags["-o"] ?? flags["--out"]);
}

function cmdEllipse(args: string[], flags: Record<string, string>): void {
  const cx = Number(args[0] ?? 100);
  const cy = Number(args[1] ?? 100);
  const rx = Number(args[2] ?? 80);
  const ry = Number(args[3] ?? 50);
  const stroke = flags["--stroke"] ?? flags["-s"] ?? "#000000";
  const fill = flags["--fill"] ?? flags["-f"] ?? "#ffffff";
  const lineWidth = Number(flags["--line-width"] ?? flags["-lw"] ?? 2);
  const label = flags["--label"] ?? flags["-l"] ?? undefined;

  const shape = new EllipseShape({
    id: nextId(), cx, cy, rx, ry, stroke, fill, lineWidth, label,
  });
  const svgWidth = Number(flags["--width"] ?? flags["-W"] ?? 800);
  const svgHeight = Number(flags["--height"] ?? flags["-H"] ?? 600);
  writeOutput(shapesToSvg([shape], svgWidth, svgHeight), flags["-o"] ?? flags["--out"]);
}

function cmdArrow(args: string[], flags: Record<string, string>): void {
  const x1 = Number(args[0] ?? 10);
  const y1 = Number(args[1] ?? 10);
  const x2 = Number(args[2] ?? 200);
  const y2 = Number(args[3] ?? 100);
  const stroke = flags["--stroke"] ?? flags["-s"] ?? "#000000";
  const fill = flags["--fill"] ?? flags["-f"] ?? "none";
  const lineWidth = Number(flags["--line-width"] ?? flags["-lw"] ?? 2);
  const label = flags["--label"] ?? flags["-l"] ?? undefined;

  const shape = new ArrowShape({
    id: nextId(), x1, y1, x2, y2, stroke, fill, lineWidth, label,
  });
  const svgWidth = Number(flags["--width"] ?? flags["-W"] ?? 800);
  const svgHeight = Number(flags["--height"] ?? flags["-H"] ?? 600);
  writeOutput(shapesToSvg([shape], svgWidth, svgHeight), flags["-o"] ?? flags["--out"]);
}

function cmdText(args: string[], flags: Record<string, string>): void {
  const x = Number(args[0] ?? 20);
  const y = Number(args[1] ?? 40);
  const text = args[2] ?? "Hello";
  const stroke = flags["--stroke"] ?? flags["-s"] ?? "#000000";
  const fill = flags["--fill"] ?? flags["-f"] ?? "none";
  const lineWidth = Number(flags["--line-width"] ?? flags["-lw"] ?? 0);
  const fontSize = Number(flags["--font-size"] ?? flags["-fs"] ?? 16);
  const fontFamily = flags["--font-family"] ?? flags["-ff"] ?? undefined;

  const shape = new TextShape({
    id: nextId(), x, y, text, fontSize, fontFamily, stroke, fill, lineWidth,
  });
  const svgWidth = Number(flags["--width"] ?? flags["-W"] ?? 800);
  const svgHeight = Number(flags["--height"] ?? flags["-H"] ?? 600);
  writeOutput(shapesToSvg([shape], svgWidth, svgHeight), flags["-o"] ?? flags["--out"]);
}

function cmdJson(args: string[], flags: Record<string, string>): void {
  const jsonPath = args[0];
  if (!jsonPath) {
    console.error("Usage: svg-sketch-cli json <shapes.json> [-o out.svg]");
    process.exit(1);
  }
  const resolved = path.resolve(jsonPath);
  const raw = fs.readFileSync(resolved, "utf-8");
  const data = JSON.parse(raw) as ShapeJSON[];
  const shapes: Shape[] = reviveShapes(data);
  const svgWidth = Number(flags["--width"] ?? flags["-W"] ?? 800);
  const svgHeight = Number(flags["--height"] ?? flags["-H"] ?? 600);
  writeOutput(shapesToSvg(shapes, svgWidth, svgHeight), flags["-o"] ?? flags["--out"]);
}

function cmdParse(args: string[], flags: Record<string, string>): void {
  const svgPath = args[0];
  if (!svgPath) {
    console.error("Usage: svg-sketch-cli parse <diagram.svg> [-o shapes.json]");
    process.exit(1);
  }
  const resolved = path.resolve(svgPath);
  const svgContent = fs.readFileSync(resolved, "utf-8");
  const data = parseDiagramData(svgContent);
  if (!data) {
    console.error("No diagram data found in SVG.");
    process.exit(1);
  }
  const json = JSON.stringify(data.shapes, null, 2);
  const outPath = flags["-o"] ?? flags["--out"];
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), json, "utf-8");
    console.log(`Written: ${path.resolve(outPath)}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

import { startServer } from "../web/server";

// --- main ---

function printHelp(): void {
  console.log(`svg-sketch-cli — SVG Sketch CLI tool

Usage:
  svg-sketch-cli <command> [args] [options]

Commands:
  rect <x> <y> <w> <h>          Create a rectangle
  ellipse <cx> <cy> <rx> <ry>   Create an ellipse
  arrow <x1> <y1> <x2> <y2>     Create an arrow
  text <x> <y> <text>           Create a text element
  json <shapes.json>            Create SVG from JSON shape array
  parse <diagram.svg>           Extract shapes JSON from SVG
  serve [--port N] [--file F]   Start web editor server

Options:
  -o, --out <file>       Output file (default: stdout)
  -s, --stroke <color>   Stroke color (default: #000000)
  -f, --fill <color>     Fill color (default: #ffffff)
  -lw, --line-width <n>  Line width (default: 2)
  -l, --label <text>     Shape label
  -W, --width <n>        SVG width (default: 800)
  -H, --height <n>       SVG height (default: 600)
  -fs, --font-size <n>   Font size (default: 16)
  -ff, --font-family <f> Font family
  -p, --port <n>         Server port (default: 3000)
  --file <path>          SVG file to edit in server mode
  -h, --help             Show this help
`);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const { positional, flags } = parseArgs(args.slice(1));

  switch (command) {
    case "rect":
      cmdRect(positional, flags);
      break;
    case "ellipse":
      cmdEllipse(positional, flags);
      break;
    case "arrow":
      cmdArrow(positional, flags);
      break;
    case "text":
      cmdText(positional, flags);
      break;
    case "json":
      cmdJson(positional, flags);
      break;
    case "parse":
      cmdParse(positional, flags);
      break;
    case "serve":
      startServer({
        port: Number(flags["-p"] ?? flags["--port"] ?? 3000),
        file: flags["--file"] ?? positional[0] ?? undefined,
      });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main();
