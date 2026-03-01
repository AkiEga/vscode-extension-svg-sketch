import * as vscode from "vscode";
import type { Shape, DiagramTemplate, DiagramTemplateSummary } from "./types";
import { shapesToSvg } from "./svgExporter";

function getWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function getTemplateDirectoryUri(): vscode.Uri | undefined {
  const root = getWorkspaceRoot();
  if (!root) {
    return undefined;
  }
  const config = vscode.workspace.getConfiguration("markdown-svg-sketch");
  const templateDir = config.get<string>("templateDir", ".markdown-svg-sketch/templates");
  return vscode.Uri.joinPath(root, templateDir);
}

function getTemplateFileUri(templateId: string): vscode.Uri | undefined {
  const dir = getTemplateDirectoryUri();
  if (!dir) {
    return undefined;
  }
  return vscode.Uri.joinPath(dir, `${templateId}.json`);
}

async function ensureTemplateDirectoryExists(): Promise<vscode.Uri | undefined> {
  const dir = getTemplateDirectoryUri();
  if (!dir) {
    return undefined;
  }
  try {
    await vscode.workspace.fs.stat(dir);
  } catch {
    await vscode.workspace.fs.createDirectory(dir);
  }
  return dir;
}

function toSummary(template: DiagramTemplate): DiagramTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    updatedAt: template.updatedAt,
    shapeCount: template.diagram.shapes.length,
    thumbnailSvg: template.thumbnailSvg,
  };
}

function now(): number {
  return Date.now();
}

function createTemplateId(): string {
  return `tpl_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function asTemplate(content: string): DiagramTemplate | undefined {
  try {
    const parsed = JSON.parse(content) as DiagramTemplate;
    if (!parsed?.id || !parsed?.name || !parsed?.diagram?.shapes) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function writeTemplate(template: DiagramTemplate): Promise<void> {
  const fileUri = getTemplateFileUri(template.id);
  if (!fileUri) {
    return;
  }
  await vscode.workspace.fs.writeFile(
    fileUri,
    Buffer.from(JSON.stringify(template, null, 2), "utf-8"),
  );
}

/** Ensure template storage exists and seed starter templates once. */
export async function ensureTemplateStorageWithSeed(): Promise<void> {
  const dir = await ensureTemplateDirectoryExists();
  if (!dir) {
    return;
  }

  const existing = await listTemplates();
  if (existing.length > 0) {
    return;
  }

  const starters: Array<{ name: string; shapes: Shape[] }> = [
    {
      name: "Steps",
      shapes: [
        { id: "s1", type: "rect", x: 60, y: 80, width: 180, height: 90, stroke: "#1f5bff", fill: "#e8f0ff", lineWidth: 2 },
        { id: "s2", type: "text", x: 95, y: 135, text: "Step 1", fontSize: 24, stroke: "#1f5bff", fill: "#1f5bff", lineWidth: 1 },
        { id: "s3", type: "arrow", x1: 250, y1: 125, x2: 360, y2: 125, stroke: "#364152", fill: "none", lineWidth: 3 },
        { id: "s4", type: "rect", x: 370, y: 80, width: 180, height: 90, stroke: "#1f5bff", fill: "#e8f0ff", lineWidth: 2 },
        { id: "s5", type: "text", x: 405, y: 135, text: "Step 2", fontSize: 24, stroke: "#1f5bff", fill: "#1f5bff", lineWidth: 1 },
      ],
    },
    {
      name: "Comparison",
      shapes: [
        { id: "c1", type: "rect", x: 70, y: 70, width: 250, height: 210, stroke: "#0f766e", fill: "#ecfdf5", lineWidth: 2 },
        { id: "c2", type: "text", x: 165, y: 105, text: "A", fontSize: 28, stroke: "#0f766e", fill: "#0f766e", lineWidth: 1 },
        { id: "c3", type: "rect", x: 360, y: 70, width: 250, height: 210, stroke: "#9a3412", fill: "#fff7ed", lineWidth: 2 },
        { id: "c4", type: "text", x: 455, y: 105, text: "B", fontSize: 28, stroke: "#9a3412", fill: "#9a3412", lineWidth: 1 },
        { id: "c5", type: "text", x: 295, y: 190, text: "vs", fontSize: 28, stroke: "#374151", fill: "#374151", lineWidth: 1 },
      ],
    },
    {
      name: "Before-After",
      shapes: [
        { id: "b1", type: "rect", x: 70, y: 70, width: 230, height: 220, stroke: "#7c2d12", fill: "#fef2f2", lineWidth: 2 },
        { id: "b2", type: "text", x: 130, y: 105, text: "Before", fontSize: 24, stroke: "#7c2d12", fill: "#7c2d12", lineWidth: 1 },
        { id: "b3", type: "arrow", x1: 320, y1: 180, x2: 410, y2: 180, stroke: "#1f2937", fill: "none", lineWidth: 4 },
        { id: "b4", type: "rect", x: 430, y: 70, width: 230, height: 220, stroke: "#14532d", fill: "#ecfdf5", lineWidth: 2 },
        { id: "b5", type: "text", x: 500, y: 105, text: "After", fontSize: 24, stroke: "#14532d", fill: "#14532d", lineWidth: 1 },
      ],
    },
  ];

  for (const starter of starters) {
    await saveTemplate(starter.name, starter.shapes);
  }
}

/** List templates stored in workspace template directory. */
export async function listTemplates(): Promise<DiagramTemplateSummary[]> {
  const dir = await ensureTemplateDirectoryExists();
  if (!dir) {
    return [];
  }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }

  const summaries: DiagramTemplateSummary[] = [];
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !name.endsWith(".json")) {
      continue;
    }
    const fileUri = vscode.Uri.joinPath(dir, name);
    try {
      const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString("utf-8");
      const template = asTemplate(content);
      if (template) {
        summaries.push(toSummary(template));
      }
    } catch {
      // Ignore malformed template files.
    }
  }

  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

/** Save current diagram as a reusable template. */
export async function saveTemplate(name: string, shapes: Shape[]): Promise<DiagramTemplateSummary | undefined> {
  const trimmed = name.trim();
  if (!trimmed || shapes.length === 0) {
    return undefined;
  }

  await ensureTemplateDirectoryExists();
  const template: DiagramTemplate = {
    id: createTemplateId(),
    name: trimmed,
    createdAt: now(),
    updatedAt: now(),
    thumbnailSvg: shapesToSvg(shapes, 320, 180),
    diagram: {
      version: 1,
      shapes,
    },
  };

  await writeTemplate(template);
  return toSummary(template);
}

/** Load a template by template id. */
export async function loadTemplate(templateId: string): Promise<DiagramTemplate | undefined> {
  const fileUri = getTemplateFileUri(templateId);
  if (!fileUri) {
    return undefined;
  }
  try {
    const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString("utf-8");
    return asTemplate(content);
  } catch {
    return undefined;
  }
}

/** Delete template by id. */
export async function deleteTemplate(templateId: string): Promise<boolean> {
  const fileUri = getTemplateFileUri(templateId);
  if (!fileUri) {
    return false;
  }
  try {
    await vscode.workspace.fs.delete(fileUri, { useTrash: false });
    return true;
  } catch {
    return false;
  }
}
