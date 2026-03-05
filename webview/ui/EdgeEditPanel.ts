/**
 * EdgeEditPanel - 図形の境界線プロパティ (stroke, lineWidth) を編集する UI パネル
 */

export interface EdgeEditPanelConfig {
  /** 編集対象の図形の現在の stroke 色 */
  stroke: string;
  /** 編集対象の図形の現在の lineWidth */
  lineWidth: number;
  /** キャンバスコンテナ要素 */
  container: HTMLElement;
  /** 値が変更されたときのコールバック（即時プレビュー用） */
  onChange: (stroke: string, lineWidth: number) => void;
  /** 確定時のコールバック（Undo スタックへの追加） */
  onCommit: (stroke: string, lineWidth: number) => void;
  /** キャンセル時のコールバック */
  onCancel: () => void;
}

export class EdgeEditPanel {
  private panel: HTMLDivElement;
  private strokeInput: HTMLInputElement;
  private lineWidthInput: HTMLInputElement;
  private config: EdgeEditPanelConfig;
  private originalStroke: string;
  private originalLineWidth: number;
  private committed = false;

  constructor(config: EdgeEditPanelConfig) {
    this.config = config;
    this.originalStroke = config.stroke;
    this.originalLineWidth = config.lineWidth;

    // パネルを作成
    this.panel = this.createPanel();
    this.strokeInput = this.panel.querySelector("#edge-stroke") as HTMLInputElement;
    this.lineWidthInput = this.panel.querySelector("#edge-linewidth") as HTMLInputElement;

    // イベントリスナーを設定
    this.attachEventListeners();

    // パネルを DOM に追加してフォーカス
    config.container.appendChild(this.panel);
    this.lineWidthInput.focus();
    this.lineWidthInput.select();
  }

  private createPanel(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.style.position = "absolute";
    panel.style.right = "20px";
    panel.style.top = "50%";
    panel.style.transform = "translateY(-50%)";
    panel.style.background = "var(--vscode-editorWidget-background, #fff)";
    panel.style.border = "1px solid var(--vscode-widget-border, #007acc)";
    panel.style.borderRadius = "4px";
    panel.style.padding = "12px";
    panel.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
    panel.style.zIndex = "100";
    panel.style.minWidth = "200px";
    panel.style.fontFamily = "var(--vscode-font-family, sans-serif)";
    panel.style.fontSize = "13px";
    panel.style.color = "var(--vscode-foreground, #000)";

    panel.innerHTML = `
      <div style="margin-bottom: 8px; font-weight: bold; color: var(--vscode-foreground, #000);">
        Edge Properties
      </div>
      <div style="margin-bottom: 10px;">
        <label for="edge-stroke" style="display: block; margin-bottom: 4px; color: var(--vscode-foreground, #000);">
          Stroke Color:
        </label>
        <input
          type="text"
          id="edge-stroke"
          value="${this.config.stroke}"
          style="width: 100%; padding: 4px; border: 1px solid var(--vscode-input-border, #ccc); background: var(--vscode-input-background, #fff); color: var(--vscode-input-foreground, #000); box-sizing: border-box;"
        />
      </div>
      <div style="margin-bottom: 10px;">
        <label for="edge-linewidth" style="display: block; margin-bottom: 4px; color: var(--vscode-foreground, #000);">
          Line Width: <span id="linewidth-value">${this.config.lineWidth}</span>
        </label>
        <input
          type="number"
          id="edge-linewidth"
          value="${this.config.lineWidth}"
          min="0.5"
          max="50"
          step="0.5"
          style="width: 100%; padding: 4px; border: 1px solid var(--vscode-input-border, #ccc); background: var(--vscode-input-background, #fff); color: var(--vscode-input-foreground, #000); box-sizing: border-box;"
        />
      </div>
      <div style="font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-top: 8px; line-height: 1.4;">
        j/k: ±1 | J/K: ±5<br>
        Ctrl+Enter: save | Esc: cancel
      </div>
    `;

    return panel;
  }

  private attachEventListeners(): void {
    // stroke 入力の変更時
    this.strokeInput.addEventListener("input", () => {
      this.config.onChange(this.strokeInput.value, parseFloat(this.lineWidthInput.value));
    });

    // lineWidth 入力の変更時
    this.lineWidthInput.addEventListener("input", () => {
      const value = parseFloat(this.lineWidthInput.value);
      const valueSpan = this.panel.querySelector("#linewidth-value") as HTMLSpanElement;
      if (valueSpan) {
        valueSpan.textContent = value.toString();
      }
      this.config.onChange(this.strokeInput.value, value);
    });

    // キーボードショートカット
    const onKeyDown = (e: KeyboardEvent) => {
      // j/k で lineWidth を ±1
      if (e.key === "j" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        this.adjustLineWidth(-1);
        return;
      }
      if (e.key === "k" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        this.adjustLineWidth(1);
        return;
      }
      // J/K で lineWidth を ±5
      if (e.key === "J" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        this.adjustLineWidth(-5);
        return;
      }
      if (e.key === "K" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        this.adjustLineWidth(5);
        return;
      }
      // Ctrl+Enter で確定
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        this.commit();
        return;
      }
      // Esc でキャンセル
      if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
        return;
      }
    };

    this.panel.addEventListener("keydown", onKeyDown);

    // パネルの外をクリックしたら確定（オプション）
    const onOutsideClick = (e: MouseEvent) => {
      if (!this.panel.contains(e.target as Node)) {
        this.commit();
      }
    };
    document.addEventListener("mousedown", onOutsideClick, true);

    // cleanup 用に保存
    (this.panel as any).__cleanup = () => {
      this.panel.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onOutsideClick, true);
    };
  }

  private adjustLineWidth(delta: number): void {
    const current = parseFloat(this.lineWidthInput.value);
    const newValue = Math.max(0.5, Math.min(50, current + delta));
    this.lineWidthInput.value = newValue.toString();
    const valueSpan = this.panel.querySelector("#linewidth-value") as HTMLSpanElement;
    if (valueSpan) {
      valueSpan.textContent = newValue.toString();
    }
    this.config.onChange(this.strokeInput.value, newValue);
  }

  private commit(): void {
    if (this.committed) { return; }
    this.committed = true;
    const stroke = this.strokeInput.value;
    const lineWidth = parseFloat(this.lineWidthInput.value);
    this.config.onCommit(stroke, lineWidth);
    this.destroy();
  }

  private cancel(): void {
    if (this.committed) { return; }
    this.committed = true;
    // 元の値に戻す
    this.config.onChange(this.originalStroke, this.originalLineWidth);
    this.config.onCancel();
    this.destroy();
  }

  private destroy(): void {
    const cleanup = (this.panel as any).__cleanup;
    if (cleanup) {
      cleanup();
    }
    if (this.panel.parentElement) {
      this.panel.parentElement.removeChild(this.panel);
    }
  }
}
