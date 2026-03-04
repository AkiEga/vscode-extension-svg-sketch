import type { Shape, ToolType } from "../shared";
import { ArrowShape } from "../shared";
import type { DragHandleId } from "./tools/SelectTool";

export type EditorMode = "idle" | "hintMode" | "handleHintMode" | "objectInsertingMode";

/** objectInsertingMode で選択可能な図形ツール一覧 */
const INSERT_TOOL_TYPES: ToolType[] = ["rect", "ellipse", "arrow", "bubble", "text", "table"];

/**
 * vimium 風のヒントラベルを n 個生成する。
 * 1文字 → 2文字の順で、home-row 優先の文字順を使用する。
 */
function generateHintLabels(n: number): string[] {
  const chars = "asdfjkl;ghqwertyuiopzxcvbnm";
  const labels: string[] = [];
  for (let i = 0; i < chars.length && labels.length < n; i++) {
    labels.push(chars[i]);
  }
  for (let i = 0; i < chars.length && labels.length < n; i++) {
    for (let j = 0; j < chars.length && labels.length < n; j++) {
      labels.push(chars[i] + chars[j]);
    }
  }
  return labels.slice(0, n);
}

/**
 * エディタのモード状態遷移を管理するクラス。
 *
 * モード一覧:
 *   idle               — 通常操作
 *   hintMode           — vimium 風の図形選択ヒント表示中（f キー）
 *   handleHintMode     — 選択図形のハンドル選択ヒント表示中（選択中に f キー）
 *   objectInsertingMode — ツールキー入力待ちの挿入モード（i キー）
 *
 * 遷移:
 *   idle → hintMode           : enterHintMode()
 *   idle → handleHintMode     : enterHandleHintMode()
 *   idle → objectInsertingMode: enterObjectInsertingMode()
 *   * → idle                  : exitToIdle()
 */
export class EditorStateMachine {
  private _mode: EditorMode = "idle";

  // hintMode 専用状態
  private _hintMap: Map<string, string> = new Map(); // ヒントラベル -> shapeId
  private _hintInput = "";

  // handleHintMode 専用状態
  private _handleHintMap: Map<string, DragHandleId> = new Map(); // キー文字 -> handleId

  // objectInsertingMode 専用状態
  private _insertSelectedIndex = 0;

  /** モード変化後（再描画など）に呼ばれるコールバック */
  private readonly onModeChange: () => void;

  constructor(onModeChange: () => void) {
    this.onModeChange = onModeChange;
  }

  // ----- 読み取りプロパティ -----

  get mode(): EditorMode { return this._mode; }
  get hintMap(): ReadonlyMap<string, string> { return this._hintMap; }
  get hintInput(): string { return this._hintInput; }
  get handleHintMap(): ReadonlyMap<string, DragHandleId> { return this._handleHintMap; }
  get insertShapeTypes(): readonly ToolType[] { return INSERT_TOOL_TYPES; }
  get insertSelectedIndex(): number { return this._insertSelectedIndex; }
  get insertSelectedType(): ToolType { return INSERT_TOOL_TYPES[this._insertSelectedIndex]; }

  // ----- モード遷移 -----

  /** idle → hintMode: 図形リストからヒントラベルを生成して移行する */
  enterHintMode(shapes: Shape[]): void {
    const labels = generateHintLabels(shapes.length);
    const map = new Map<string, string>();
    for (let i = 0; i < shapes.length; i++) {
      map.set(labels[i], shapes[i].id);
    }
    this._hintMap = map;
    this._hintInput = "";
    this._mode = "hintMode";
    this.onModeChange();
  }

  /** idle → handleHintMode: 選択図形のハンドルキーマップを構築して移行する */
  enterHandleHintMode(shape: Shape): void {
    const map = new Map<string, DragHandleId>();
    if (shape instanceof ArrowShape) {
      map.set("s", "start");
      map.set("e", "end");
    } else {
      // 数字キー: 1=tl, 2=tr, 3=bl, 4=br (位置イメージ)
      map.set("1", "tl");
      map.set("2", "tr");
      map.set("3", "bl");
      map.set("4", "br");
    }
    this._handleHintMap = map;
    this._mode = "handleHintMode";
    this.onModeChange();
  }

  /** idle → objectInsertingMode */
  enterObjectInsertingMode(): void {
    this._insertSelectedIndex = 0;
    this._mode = "objectInsertingMode";
    this.onModeChange();
  }

  /** objectInsertingMode: 選択を上下に移動する */
  moveInsertSelection(delta: number): void {
    const len = INSERT_TOOL_TYPES.length;
    this._insertSelectedIndex = ((this._insertSelectedIndex + delta) % len + len) % len;
    this.onModeChange();
  }

  /** 任意のモード → idle（状態をリセット） */
  exitToIdle(): void {
    this._mode = "idle";
    this._hintMap = new Map();
    this._hintInput = "";
    this._handleHintMap = new Map();
    this._insertSelectedIndex = 0;
    this.onModeChange();
  }

  // ----- hintMode: 文字入力処理 -----

  /**
   * hintMode 中に1文字を受け取り、照合結果を返す。
   *
   * 戻り値:
   *   string    — 完全一致した shapeId（呼び出し元で選択 & exitToIdle() すること）
   *   null      — 候補なし（自動的に exitToIdle() 済み）
   *   undefined — まだ候補がある（継続入力を待つ）
   */
  processHintInput(char: string): string | null | undefined {
    this._hintInput += char.toLowerCase();
    const shapeId = this._hintMap.get(this._hintInput);
    if (shapeId !== undefined) {
      return shapeId;
    }
    const hasPrefix = [...this._hintMap.keys()].some((k) => k.startsWith(this._hintInput));
    if (!hasPrefix) {
      this.exitToIdle();
      return null;
    }
    this.onModeChange(); // 未確定ラベルの描画更新
    return undefined;
  }

  // ----- handleHintMode: 文字入力処理 -----

  /**
   * handleHintMode 中に1文字を受け取り、対応する handleId を返す。
   * 一致・不一致に関わらず idle に戻る。
   */
  processHandleInput(char: string): DragHandleId | null {
    const handleId = this._handleHintMap.get(char.toLowerCase()) ?? null;
    this.exitToIdle();
    return handleId;
  }
}
