# Markdown SVG Sketch — 設計・開発ログ

## 概要

VS Code 上で Markdown 執筆中に SVG 形式の図を簡単に作成できる拡張機能を新規開発した。

---

## 1. 要件ヒアリング

以下の質問を通じて要件を確定した。

| 質問 | 回答 |
|------|------|
| 新規 or 既存拡張の改善？ | **新しい拡張機能を作成する** |
| どのような図の作成を想定？ | **手描き風の簡易作図ツール** |
| ワークフロー | **WebView パネルで描画し、ファイルとして保存** |
| 手描き風のスタイル | **シンプルな図形エディタ（矢印、四角、円、テキスト）** |
| SVG の保存・連携方法 | **.svg ファイルとして保存し、Markdown にリンクを自動挿入** |
| ビルドツール | **TypeScript + esbuild（軽量・高速）** |

### 背景調査

同ワークスペース内の既存拡張を調査した：

- `quick-paste-as-drawio-svg` — クリップボード画像 → draw.io SVG のワークフロー
- `touch-drawio-svg` — `.drawio.svg` ファイル作成 & Markdown リンク挿入
- `vscode-copilot-chat` — GitHub Copilot Chat（SVG/MD 無関係）
- `vscode-extension-section-info` — コード断片をMarkdown形式でコピー
- `vscode-extension-tree` — ファイルツリー可視化

既存拡張のパターン（コマンド登録、ファイル保存、MD リンク挿入）を参考に設計した。

---

## 2. 設計方針

### 技術スタック

- **言語**: TypeScript
- **ビルド**: esbuild（extension 本体 = Node / WebView = browser の 2 ターゲット）
- **描画**: Canvas API ベースの自作エディタ → SVG 出力
- **対象 VS Code**: ^1.86.0

### アーキテクチャ

```
┌─────────────────────┐     postMessage      ┌─────────────────────┐
│   Extension (Node)  │ ◄──────────────────► │   WebView (Browser) │
│                     │                       │                     │
│ ・コマンド登録       │     save / init       │ ・CanvasEditor      │
│ ・DiagramPanel管理   │ ◄──────────────────► │ ・5つの描画ツール    │
│ ・ファイル保存       │                       │ ・プロパティパネル    │
│ ・MDリンク挿入       │                       │ ・SVGシリアライズ    │
└─────────────────────┘                       └─────────────────────┘
```

### SVG 再編集の仕組み

SVG に `data-diagram` 属性として図形データ（JSON）を埋め込み、再編集時にパースして復元する。

```xml
<svg data-editor="markdown-svg-sketch"
     data-diagram='{"version":1,"shapes":[...]}'>
  <rect data-shape-id="s1" .../>
</svg>
```

---

## 3. プロジェクト構成

```
markdown-svg-sketch/
├── src/                          # Extension 側 (Node)
│   ├── extension.ts              # activate/deactivate, コマンド登録
│   ├── diagramPanel.ts           # WebView パネル管理・HTML生成・メッセージ通信
│   ├── svgExporter.ts            # Shape[] → SVG文字列 / SVG → DiagramData パース
│   ├── fileUtils.ts              # ファイル保存・パス解決・重複回避・MDリンク挿入
│   └── types.ts                  # 共有型定義 (Shape, DiagramData, メッセージ型)
├── webview/                      # WebView 側 (Browser)
│   ├── main.ts                   # エントリポイント (ツールバーバインド, VS Code通信)
│   ├── shared.ts                 # 共有ユーティリティ (hitTest, nextId, 型re-export)
│   └── canvas/
│       ├── CanvasEditor.ts       # メインエディタ (マウスイベント, Undo/Redo, 描画ループ)
│       ├── render.ts             # Canvas描画 (グリッド, 図形, 選択インジケータ)
│       └── tools/
│           ├── RectTool.ts       # 四角形ツール
│           ├── EllipseTool.ts    # 楕円ツール
│           ├── ArrowTool.ts      # 矢印ツール
│           ├── TextTool.ts       # テキストツール
│           └── SelectTool.ts     # 選択・移動ツール
├── out/                          # ビルド出力
│   ├── extension.js              # Extension バンドル (~7KB)
│   └── webview.js                # WebView バンドル (~11KB)
├── esbuild.mjs                   # ビルド設定 (2ターゲット, watch対応)
├── package.json                  # 拡張マニフェスト (commands, menus, configuration)
├── tsconfig.json                 # Extension 用 TypeScript 設定
├── tsconfig.webview.json         # WebView 用 TypeScript 設定
├── .vscodeignore
├── README.md
└── CHANGELOG.md
```

---

## 4. 実装フェーズ

### Phase 1: プロジェクト初期設定
- `package.json` — 拡張マニフェスト (commands, menus, configuration)
- `tsconfig.json` / `tsconfig.webview.json` — TypeScript設定 (Node vs Browser)
- `esbuild.mjs` — 2ターゲットビルド (extension + webview)
- `npm install` で依存関係インストール

### Phase 2: Extension 側実装
- `types.ts` — `Shape` 型 (RectShape, EllipseShape, ArrowShape, TextShape) とメッセージ型
- `fileUtils.ts` — 連番ファイル名生成、SVG保存、MDリンク挿入
- `svgExporter.ts` — 図形データ ↔ SVG 文字列の変換
- `diagramPanel.ts` — WebViewPanel管理、HTML/CSS生成（VS Codeテーマ変数使用）、CSP設定
- `extension.ts` — `newDiagram` / `editSvg` コマンド登録

### Phase 3: WebView 側実装
- `shared.ts` — ヒットテスト、ID生成、型定義
- 5つの描画ツール — `RectTool`, `EllipseTool`, `ArrowTool`, `TextTool`, `SelectTool`
- `render.ts` — Canvas描画 (グリッド、図形、選択ハイライト、プレビュー)
- `CanvasEditor.ts` — マウスイベント処理、Undo/Redo スタック、リサイズ対応
- `main.ts` — ツールバーバインド、キーボードショートカット、VS Code通信

### Phase 4: ビルド検証
- インポートパス修正 (`../shared` → `../../shared` for tools)
- `npm run build` — 成功確認

---

## 5. 実装された機能一覧

| 機能 | 説明 |
|------|------|
| 新規図作成 | Markdown右クリック → `New Diagram` でWebViewエディタ起動 |
| 四角形ツール | ドラッグで矩形作成 (fill/stroke/lineWidth対応) |
| 楕円ツール | ドラッグで楕円作成 |
| 矢印ツール | 始点→終点でarrowhead付き矢印 |
| テキストツール | クリック位置にテキスト配置 (prompt入力) |
| 選択/移動 | クリック選択、ドラッグ移動 |
| 削除 | Delete/Backspaceで選択図形削除 |
| Undo/Redo | Ctrl+Z / Ctrl+Y (操作履歴スタック) |
| 色・線幅変更 | ツールバーのカラーピッカー・数値入力 |
| SVG保存 | `img/diagram_N.svg` として保存 (連番自動) |
| MDリンク挿入 | 保存後に `![](img/diagram_0.svg)` を自動挿入 |
| SVG再編集 | `.svg` 右クリック → `Edit SVG` で再読み込み |
| キーボードショートカット | V=選択, R=四角, E=楕円, A=矢印, T=テキスト |
| VS Codeテーマ対応 | CSS変数でダーク/ライトテーマ自動適応 |
| CSP設定 | WebView の Content Security Policy を適切に設定 |

---

## 6. 設定項目

| 設定キー | デフォルト | 説明 |
|----------|-----------|------|
| `markdown-svg-sketch.imgDir` | `img` | SVG保存先ディレクトリ (MDファイルからの相対) |
| `markdown-svg-sketch.filePrefix` | `diagram` | ファイル名プレフィックス |

---

## 7. 今後の改善候補

- [ ] リサイズハンドルによる図形サイズ変更
- [ ] 図形のコピー＆ペースト
- [ ] グリッドスナップ
- [ ] Rough.js 連携による手描き風スタイル
- [ ] SVG プレビュー on Markdown Preview
- [ ] 複数図形の一括選択
- [ ] エクスポート形式の追加 (PNG等)
- [ ] テスト追加 (Unit / Integration)
