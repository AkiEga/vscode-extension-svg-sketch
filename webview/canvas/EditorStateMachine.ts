import type { ToolType, Point } from "../shared";

export type EditorMode = "idle" | "objectInsertingMode" | "objSelect" | "objEdit" | "vimInsert" | "vimVisual";
export type ObjEditSubMode = "select" | "labelEdit" | "edgeEdit" | "fillStyleEdit";

/** objectInsertingMode で選択可能な図形ツール一覧 */
const INSERT_TOOL_TYPES: ToolType[] = ["rect", "ellipse", "arrow", "text", "table"];
const INSERT_SHORTCUTS: Readonly<Record<string, ToolType>> = {
  r: "rect",
  e: "ellipse",
  a: "arrow",
  t: "text",
  g: "table",
};

/**
 * エディタのモード状態遷移を管理するクラス。
 */
export class EditorStateMachine {
  private _mode: EditorMode = "idle";

  // objectInsertingMode 専用状態
  private _insertSelectedIndex = 0;

  // objSelect 専用状態
  private _selectedShapeIds: string[] = [];

  // objEdit 専用状態
  private _objEditSubMode: ObjEditSubMode = "select";
  private _editingShapeId = "";

  // vimVisual 専用状態
  private _visualAnchor: Point = { x: 0, y: 0 };

  /** モード変化後（再描画など）に呼ばれるコールバック */
  private readonly onModeChange: () => void;

  constructor(onModeChange: () => void) {
    this.onModeChange = onModeChange;
  }

  // ----- 読み取りプロパティ -----

  get mode(): EditorMode { return this._mode; }
  get insertShapeTypes(): readonly ToolType[] { return INSERT_TOOL_TYPES; }
  get insertSelectedIndex(): number { return this._insertSelectedIndex; }
  get insertSelectedType(): ToolType { return INSERT_TOOL_TYPES[this._insertSelectedIndex]; }
  get selectedShapeIds(): readonly string[] { return this._selectedShapeIds; }
  get objEditSubMode(): ObjEditSubMode { return this._objEditSubMode; }
  get editingShapeId(): string { return this._editingShapeId; }
  get visualAnchor(): Point { return { ...this._visualAnchor }; }

  // ----- モード遷移 -----

  /** idle → objectInsertingMode */
  enterObjectInsertingMode(): void {
    this._insertSelectedIndex = 0;
    this._mode = "objectInsertingMode";
    this.onModeChange();
  }

  /** idle → objSelect: 選択された図形 ID を記録して objSelect モードに入る */
  enterObjSelect(selectedIds: string[]): void {
    this._selectedShapeIds = [...selectedIds];
    this._mode = "objSelect";
    this.onModeChange();
  }

  /** objSelect → objEdit: 図形編集モードに入る */
  enterObjEdit(shapeId: string, subMode: ObjEditSubMode = "select"): void {
    this._editingShapeId = shapeId;
    this._objEditSubMode = subMode;
    this._mode = "objEdit";
    this.onModeChange();
  }

  /** objEdit のサブモードを変更する */
  setObjEditSubMode(subMode: ObjEditSubMode): void {
    this._objEditSubMode = subMode;
    this.onModeChange();
  }

  /** objEdit → objSelect: 編集モードから選択モードへ戻る */
  exitObjEditToObjSelect(): void {
    this._mode = "objSelect";
    this._selectedShapeIds = [this._editingShapeId];
    this._editingShapeId = "";
    this._objEditSubMode = "select";
    this.onModeChange();
  }

  /** objectInsertingMode: 選択を上下に移動する */
  moveInsertSelection(delta: number): void {
    const len = INSERT_TOOL_TYPES.length;
    this._insertSelectedIndex = ((this._insertSelectedIndex + delta) % len + len) % len;
    this.onModeChange();
  }

  /** objectInsertingMode: 1文字ショートカットで図形種別を選択する */
  selectInsertByShortcut(char: string): boolean {
    const toolType = INSERT_SHORTCUTS[char.toLowerCase()];
    if (!toolType) {
      return false;
    }
    const idx = INSERT_TOOL_TYPES.indexOf(toolType);
    if (idx < 0) {
      return false;
    }
    this._insertSelectedIndex = idx;
    this.onModeChange();
    return true;
  }

  /** idle → vimInsert: カーソル位置でテキスト入力モードに入る */
  enterVimInsert(): void {
    this._mode = "vimInsert";
    this.onModeChange();
  }

  /** idle → vimVisual: カーソル位置を選択範囲の起点として Visual モードに入る */
  enterVimVisual(anchor: Point): void {
    this._visualAnchor = { ...anchor };
    this._mode = "vimVisual";
    this.onModeChange();
  }

  /** 任意のモード → idle（状態をリセット） */
  exitToIdle(): void {
    this._mode = "idle";
    this._insertSelectedIndex = 0;
    this._selectedShapeIds = [];
    this._editingShapeId = "";
    this._objEditSubMode = "select";
    this.onModeChange();
  }

}
