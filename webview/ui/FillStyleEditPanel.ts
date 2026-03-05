/**
 * FillStyleEditPanel - 図形の塗りつぶしプロパティ (fill, opacity, cornerRadius) を編集する UI パネル
 */

export interface FillStyleEditPanelConfig {
  /** 編集対象の図形の現在の fill 色 */
  fill: string;
  /** 編集対象の図形の現在の opacity (0-1) */
  opacity?: number;
  /** 編集対象の図形の現在の cornerRadius (RectShape のみ) */
  cornerRadius?: number;
  /** RectShape かどうか */
  isRect: boolean;
  /** キャンバスコンテナ要素 */
  container: HTMLElement;
  /** 値が変更されたときのコールバック（即時プレビュー用） */
  onChange: (fill: string, opacity: number | undefined, cornerRadius: number | undefined) => void;
  /** 確定時のコールバック（Undo スタックへの追加） */
  onCommit: (fill: string, opacity: number | undefined, cornerRadius: number | undefined) => void;
  /** キャンセル時のコールバック */
  onCancel: () => void;
}

export class FillStyleEditPanel {
  private panel: HTMLDivElement;
  private fillInput: HTMLInputElement;
  private opacityInput: HTMLInputElement | null = null;
  private cornerRadiusInput: HTMLInputElement | null = null;
  private config: FillStyleEditPanelConfig;
  private originalFill: string;
  private originalOpacity: number | undefined;
  private originalCornerRadius: number | undefined;
  private committed = false;

  constructor(config: FillStyleEditPanelConfig) {
    this.config = config;
    this.originalFill = config.fill;
    this.originalOpacity = config.opacity;
    this.originalCornerRadius = config.cornerRadius;

    // パネルを作成
    this.panel = this.createPanel();
    this.fillInput = this.panel.querySelector("#fill-color") as HTMLInputElement;
    this.opacityInput = this.panel.querySelector("#fill-opacity") as HTMLInputElement | null;
    this.cornerRadiusInput = this.panel.querySelector("#corner-radius") as HTMLInputElement | null;

    // イベントリスナーを設定
    this.attachEventListeners();

    // パネルを DOM に追加してフォーカス
    config.container.appendChild(this.panel);
    this.fillInput.focus();
    this.fillInput.select();
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

    let opacityHTML = "";
    if (this.config.opacity !== undefined) {
      const opacityPercent = Math.round((this.config.opacity ?? 1) * 100);
      opacityHTML = `
        <div style="margin-bottom: 10px;">
          <label for="fill-opacity" style="display: block; margin-bottom: 4px; color: var(--vscode-foreground, #000);">
            Opacity: <span id="opacity-value">${opacityPercent}%</span>
          </label>
          <input
            type="range"
            id="fill-opacity"
            value="${opacityPercent}"
            min="0"
            max="100"
            step="5"
            style="width: 100%;"
          />
        </div>
      `;
    }

    let cornerRadiusHTML = "";
    if (this.config.isRect && this.config.cornerRadius !== undefined) {
      cornerRadiusHTML = `
        <div style="margin-bottom: 10px;">
          <label for="corner-radius" style="display: block; margin-bottom: 4px; color: var(--vscode-foreground, #000);">
            Corner Radius: <span id="cornerradius-value">${this.config.cornerRadius}</span>
          </label>
          <input
            type="number"
            id="corner-radius"
            value="${this.config.cornerRadius}"
            min="0"
            max="100"
            step="1"
            style="width: 100%; padding: 4px; border: 1px solid var(--vscode-input-border, #ccc); background: var(--vscode-input-background, #fff); color: var(--vscode-input-foreground, #000); box-sizing: border-box;"
          />
        </div>
      `;
    }

    panel.innerHTML = `
      <div style="margin-bottom: 8px; font-weight: bold; color: var(--vscode-foreground, #000);">
        Fill Style Properties
      </div>
      <div style="margin-bottom: 10px;">
        <label for="fill-color" style="display: block; margin-bottom: 4px; color: var(--vscode-foreground, #000);">
          Fill Color:
        </label>
        <input
          type="text"
          id="fill-color"
          value="${this.config.fill}"
          style="width: 100%; padding: 4px; border: 1px solid var(--vscode-input-border, #ccc); background: var(--vscode-input-background, #fff); color: var(--vscode-input-foreground, #000); box-sizing: border-box;"
        />
      </div>
      ${opacityHTML}
      ${cornerRadiusHTML}
      <div style="font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-top: 8px; line-height: 1.4;">
        ${this.config.isRect && this.config.cornerRadius !== undefined ? "j/k: ±1 radius | J/K: ±5<br>" : ""}
        Ctrl+Enter: save | Esc: cancel
      </div>
    `;

    return panel;
  }

  private attachEventListeners(): void {
    // fill 入力の変更時
    this.fillInput.addEventListener("input", () => {
      this.notifyChange();
    });

    // opacity 入力の変更時
    if (this.opacityInput) {
      this.opacityInput.addEventListener("input", () => {
        const percent = parseInt(this.opacityInput!.value, 10);
        const valueSpan = this.panel.querySelector("#opacity-value") as HTMLSpanElement;
        if (valueSpan) {
          valueSpan.textContent = `${percent}%`;
        }
        this.notifyChange();
      });
    }

    // cornerRadius 入力の変更時
    if (this.cornerRadiusInput) {
      this.cornerRadiusInput.addEventListener("input", () => {
        const value = parseFloat(this.cornerRadiusInput!.value);
        const valueSpan = this.panel.querySelector("#cornerradius-value") as HTMLSpanElement;
        if (valueSpan) {
          valueSpan.textContent = value.toString();
        }
        this.notifyChange();
      });
    }

    // キーボードショートカット
    const onKeyDown = (e: KeyboardEvent) => {
      // j/k で cornerRadius を ±1 (RectShape のみ)
      if (this.cornerRadiusInput) {
        if (e.key === "j" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          this.adjustCornerRadius(-1);
          return;
        }
        if (e.key === "k" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          this.adjustCornerRadius(1);
          return;
        }
        // J/K で cornerRadius を ±5
        if (e.key === "J" && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.adjustCornerRadius(-5);
          return;
        }
        if (e.key === "K" && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.adjustCornerRadius(5);
          return;
        }
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

    // パネルの外をクリックしたら確定
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

  private notifyChange(): void {
    const fill = this.fillInput.value;
    const opacity = this.opacityInput
      ? parseInt(this.opacityInput.value, 10) / 100
      : this.config.opacity;
    const cornerRadius = this.cornerRadiusInput
      ? parseFloat(this.cornerRadiusInput.value)
      : this.config.cornerRadius;
    this.config.onChange(fill, opacity, cornerRadius);
  }

  private adjustCornerRadius(delta: number): void {
    if (!this.cornerRadiusInput) { return; }
    const current = parseFloat(this.cornerRadiusInput.value);
    const newValue = Math.max(0, Math.min(100, current + delta));
    this.cornerRadiusInput.value = newValue.toString();
    const valueSpan = this.panel.querySelector("#cornerradius-value") as HTMLSpanElement;
    if (valueSpan) {
      valueSpan.textContent = newValue.toString();
    }
    this.notifyChange();
  }

  private commit(): void {
    if (this.committed) { return; }
    this.committed = true;
    const fill = this.fillInput.value;
    const opacity = this.opacityInput
      ? parseInt(this.opacityInput.value, 10) / 100
      : this.config.opacity;
    const cornerRadius = this.cornerRadiusInput
      ? parseFloat(this.cornerRadiusInput.value)
      : this.config.cornerRadius;
    this.config.onCommit(fill, opacity, cornerRadius);
    this.destroy();
  }

  private cancel(): void {
    if (this.committed) { return; }
    this.committed = true;
    // 元の値に戻す
    this.config.onChange(this.originalFill, this.originalOpacity, this.originalCornerRadius);
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
