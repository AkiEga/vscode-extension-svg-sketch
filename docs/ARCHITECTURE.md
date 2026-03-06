# ASCII Sketch — アーキテクチャ説明書

> 最終更新: 2026-03-07

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [ディレクトリ構成](#2-ディレクトリ構成)
3. [全体アーキテクチャ図](#3-全体アーキテクチャ図)
4. [Extension 側 (src/)](#4-extension-側-src)
5. [WebView 側 (webview/)](#5-webview-側-webview)
6. [メッセージプロトコル](#6-メッセージプロトコル)
7. [Markdown 連携フロー](#7-markdown-連携フロー)
8. [プレースホルダ追跡の仕組み](#8-プレースホルダ追跡の仕組み)
9. [ASCII エディタの内部構造](#9-ascii-エディタの内部構造)
10. [ビルドとテスト](#10-ビルドとテスト)
11. [Canvas エディタ (未完成)](#11-canvas-エディタ-未完成)
12. [今後の課題](#12-今後の課題)

---

## 1. プロジェクト概要

**ASCII Sketch** は VS Code 拡張機能で、Markdown 内の `ascii-sketch` コードブロックを Canvas ベースのエディタで作成・編集する。

````markdown
これはサンプルです:

```ascii-sketch
+--------+     +--------+
| Server |---->| Client |
+--------+     +--------+
```
````

```

- Markdown 上で右クリック → 「New Diagram」や「Edit Diagram」で WebView エディタが開く
- WebView 内で ASCII アートを描画
- Save すると Markdown のコードブロックに自動反映

---

## 2. ディレクトリ構成

```

vscode-extension-svg-sketch/
+-- src/ # Extension (Node.js, CJS)
| +-- extension.ts # エントリポイント: コマンド登録
| +-- diagramPanel.ts # WebView パネル管理・ライフサイクル
| +-- markdownIntegration.ts # Markdown ブロック検索・挿入・置換
| +-- settings.ts # 設定読み取り
| +-- types.ts # Extension <-> WebView 共有型定義
| +-- shapeConfig.ts # 図形デフォルト設定 (将来用)
| +-- fileUtils.ts # ファイルユーティリティ (将来用)
|
+-- webview/ # WebView (Browser, IIFE)
| +-- main.ts # WebView エントリポイント
| +-- shared.ts # src/types.ts の re-export 窓口
| +-- ascii/ # ASCII エディタコア
| | +-- AsciiBuffer.ts # 2D 文字グリッド + カーソル管理
| | +-- AsciiEditor.ts # エディタ本体 (入力・Undo・保存)
| | +-- AsciiRenderer.ts # Canvas 描画エンジン
| | +-- BoxDrawing.ts # 罫線描画ユーティリティ
| +-- canvas/ # Canvas エディタ (未完成)
| | +-- CanvasEditor.ts # ベクター図形エディタ
| | +-- render.ts # 図形描画
| | +-- drawStyle.ts # 描画スタイル
| | +-- EditorStateMachine.ts # モード管理
| | +-- tools/ # 描画ツール群
| +-- ui/ # UI パネル (未完成)
|
+-- test/ # ユニットテスト (vitest)
+-- out/ # ビルド出力
| +-- extension.js # Extension バンドル
| +-- webview.js # WebView バンドル
+-- esbuild.mjs # ビルドスクリプト
+-- package.json # 拡張機能マニフェスト

```

---

## 3. 全体アーキテクチャ図

```

+----------------------------------------------------------+
| VS Code Host Process (Node.js) |
| |
| +----------------+ +----------------------------+ |
| | extension.ts | --> | diagramPanel.ts | |
| | | | | |
| | Command | | _ WebView panel mgmt | |
| | _ newDiagram | | _ Markdown read/write | |
| | _ editDiagram | | _ Placeholder tracking | |
| +----------------+ +-------------+--------------+ |
| | |
| +-----------------------------+ | postMessage |
| | markdownIntegration.ts | | |
| | _ Block search | <----+ |
| | _ Insert / Replace / Delete | |
| +-----------------------------+ |
+-------------------------------+--------------------------+
| postMessage
+-------------------------------v--------------------------+
| WebView Process (Browser) |
| |
| +------------------------------------------------------+|
| | main.ts (IIFE) ||
| | _ acquireVsCodeApi() ||
| | _ Create AsciiEditor ||
| | _ Message routing ||
| +----------------------------+-------------------------+|
| | |
| +----------------------------v-------------------------+|
| | AsciiEditor (webview/ascii/) ||
| | +-------------+ +--------------+ +------------+ ||
| | | AsciiBuffer | | AsciiRenderer| | BoxDrawing | ||
| | | char grid | | Canvas draw | | box utils | ||
| | +-------------+ +--------------+ +------------+ ||
| +------------------------------------------------------+|
+----------------------------------------------------------+

```

---

## 4. Extension 側 (src/)

### 4.1 extension.ts — エントリポイント

VS Code がこの拡張機能をアクティベートすると `activate()` が呼ばれる。

```

activate()
+-- コマンド登録: "ascii-sketch.newDiagram"
| +-- アクティブエディタが Markdown -> DiagramPanel.createOrShow(新規)
+-- コマンド登録: "ascii-sketch.editDiagram"
+-- カーソル位置の ascii-sketch ブロックを検索 -> DiagramPanel.createOrShow(既存内容)

```

### 4.2 diagramPanel.ts — WebView パネル管理

`DiagramPanel` はシングルトンパターンで WebView パネルを管理する。

**主要プロパティ:**

| プロパティ | 型 | 説明 |
|---|---|---|
| `mdEditor` | `TextEditor?` | 保存先の Markdown エディタ |
| `blockRange` | `Range?` | 編集中ブロックの範囲 |
| `editingBlockId` | `string?` | プレースホルダ追跡用 ID (SHA256 の先頭 12 文字) |
| `committedContent` | `string?` | 最後に保存した内容 |
| `skipRestoreOnDispose` | `boolean` | SaveAndClose 時にプレースホルダ復元をスキップ |

**ライフサイクル:**

```

createOrShow()
|
+-- 新規パネルの場合:
| +-- WebviewPanel 作成
| +-- DiagramPanel インスタンス生成
| +-- switchTarget() 呼び出し
|
+-- 既存パネルの場合:
+-- switchTarget() でターゲット切り替え

switchTarget()
+-- restoreTrackedBlock() <- 前のプレースホルダを復元
+-- activateEditingPlaceholder() <- 新しいプレースホルダを挿入
+-- init メッセージ送信

dispose()
+-- restoreTrackedBlock() <- プレースホルダを最終内容で復元
+-- リソース解放

````

### 4.3 markdownIntegration.ts — Markdown 操作

Markdown ドキュメント内の `ascii-sketch` コードブロックを検索・操作するユーティリティ。

**主要関数:**

| 関数 | 説明 |
|---|---|
| `findAsciiBlock(doc, pos)` | 指定位置の ascii-sketch ブロックを検索 |
| `findEditingPlaceholder(doc, id)` | ID でプレースホルダブロックを検索 |
| `insertAsciiBlock(editor, pos, content)` | 新しいブロックを挿入 |
| `replaceAsciiBlock(editor, range, content)` | 既存ブロックの内容を置換 |
| `formatAsciiBlock(content, eol)` | `` ```ascii-sketch ... ``` `` で囲む |
| `formatEditingPlaceholder(id, eol)` | 編集中プレースホルダを生成 |
| `replaceRange(editor, range, text)` | 範囲テキスト置換 |
| `deleteRange(editor, range)` | 範囲削除 |

**正規表現パターン:**

```regexp
/```ascii-sketch\r?\n([\s\S]*?)\r?\n```/g
````

CRLF / LF の両方に対応。グローバルフラグ付きで使用する際は `lastIndex` をリセットする。

### 4.4 settings.ts — 設定

```typescript
{
  defaultWidth:  20〜400 (デフォルト: 80),
  defaultHeight: 5〜200  (デフォルト: 20)
}
```

VS Code の設定 `ascii-sketch.defaultWidth` / `ascii-sketch.defaultHeight` から読み取り。

### 4.5 types.ts — 共有型定義

```typescript
// Extension → WebView
type ExtToWebviewMessage = {
  command: "init";
  content?: string;
  settings: EditorSettings;
};

// WebView → Extension
type WebviewToExtMessage =
  | { command: "ready" }
  | { command: "save"; content: string }
  | { command: "saveAndClose"; content: string }
  | { command: "close" };
```

---

## 5. WebView 側 (webview/)

### 5.1 main.ts — エントリポイント

IIFE でラップされた WebView ブートストラップ。

```typescript
(function mainIIFE() {
  const vscode = acquireVsCodeApi();
  const editor = new AsciiEditor(canvas, elements, {
    onSave: (content, close) =>
      postMessage({ command: close ? "saveAndClose" : "save", content }),
    onClose: () => postMessage({ command: "close" }),
  });

  window.addEventListener("message", (event) => {
    if (event.data.command === "init") {
      editor.load(event.data.content ?? "");
    }
  });

  postMessage({ command: "ready" });
})();
```

### 5.2 shared.ts — 型の窓口

`src/types.ts` の型を re-export する。WebView 側のコードは直接 `src/types.ts` を import せず、必ず `shared.ts` 経由で使う（ビルドターゲットが異なるため）。

---

## 6. メッセージプロトコル

Extension ↔ WebView 間は `postMessage` で通信する。型安全な判別共用体を使用。

```
+----------------+                  +----------------+
|   Extension    |                  |    WebView     |
| (diagramPanel) |                  |   (main.ts)    |
+-------+--------+                  +--------+-------+
        |                                    |
        |  <-- { command: "ready" } ---------+  WebView 起動完了
        |                                    |
        +-- { command: "init",        -----> |  初期データ送信
        |     content: "...",                |
        |     settings: {...} }              |
        |                                    |
        |  <-- { command: "save",     -------+  内部キャッシュ保存
        |         content: "..." }           |
        |                                    |
        |  <-- { command: "saveAndClose", ---+  最終保存 & パネル閉じ
        |         content: "..." }           |
        |                                    |
        |  <-- { command: "close" } ---------+  キャンセル (保存なし)
        |                                    |
```

---

## 7. Markdown 連携フロー

### 7.1 新規ダイアグラム作成

````
ユーザー: Markdown で右クリック -> "ASCII Sketch: New Diagram"
    |
    v
extension.ts
    | DiagramPanel.createOrShow(extensionUri, mdEditor, undefined, undefined, cursorPos)
    v
diagramPanel.ts: switchTarget()
    |
    +- activateEditingPlaceholder()
    |   +- Markdown に挿入:
    |        ```ascii-sketch
    |        Editing... (id: a1b2c3d4e5f6)
    |        ```
    |
    +- WebView に init 送信 (content = undefined -> 空エディタ)
    |
    v
ユーザー: ASCII アートを作成
    |
    +- [Save] -> WebView -> "save" -> committedContent にキャッシュ
    |   (プレースホルダはそのまま残る)
    |
    +- [SaveAndClose] -> WebView -> "saveAndClose"
        +- finalizeToMarkdown():
           プレースホルダを実際の内容で置換:
           ```ascii-sketch
           +--------+
           | Hello! |
           +--------+
           ```
````

### 7.2 既存ダイアグラム編集

```
ユーザー: ascii-sketch ブロック内にカーソル -> "Edit Diagram At Cursor"
    |
    v
extension.ts
    | findAsciiBlock(doc, cursorPos) -> { content, range }
    | DiagramPanel.createOrShow(..., content, blockRange)
    v
diagramPanel.ts: switchTarget()
    |
    +- activateEditingPlaceholder()
    |   +- 既存ブロックをプレースホルダに置換
    |
    +- WebView に init 送信 (content = 既存内容)
```

---

## 8. プレースホルダ追跡の仕組み

**問題:** WebView で編集中に Markdown が変更されると、保存先のブロック位置がずれる。

**解決策:** 編集開始時にプレースホルダ（一意 ID 付き）をブロックに挿入し、保存時に ID で検索する。

````
編集開始前:                        編集中:
+----------------------+          +----------------------------------+
| # My Doc             |          | # My Doc                         |
|                      |          |                                  |
| ```ascii-sketch      |   -->    | ```ascii-sketch                  |
| +---+                |          | Editing... (id: a1b2c3d4e5f6)    |
| | A |                |          | ```                              |
| +---+                |          |                                  |
| ```                  |          | (他の行が追加/削除されても       |
|                      |          |  ID で正しい位置を追跡できる)     |
+----------------------+          +----------------------------------+
````

**ID 生成:** SHA256(URI + 位置 + 時刻 + 乱数) の先頭 12 文字

**ライフサイクル:**

| 操作                  | プレースホルダの状態                               |
| --------------------- | -------------------------------------------------- |
| パネル開く            | 挿入される (or 既存ブロックを置換)                 |
| Save (内部キャッシュ) | プレースホルダのまま残る                           |
| SaveAndClose          | 最終内容で置換される → プレースホルダ消滅          |
| Close (キャンセル)    | `committedContent` があれば復元、なければ削除      |
| ターゲット切り替え    | 前のプレースホルダを復元、新しいプレースホルダ挿入 |

---

## 9. ASCII エディタの内部構造

### 9.1 AsciiBuffer — 文字グリッド

2D セル配列 (`string[][]`) で ASCII アートを管理する。

```
セル構造:
cells[row][col] = "A"     ← 半角文字 (幅 1)
cells[row][col] = "日"    ← 全角文字 (幅 2, 次のセルは "")
cells[row][col] = " "     ← 空白
cells[row][col] = ""      ← 全角文字の後続セル (スキップ)
```

**主要機能:**

- カーソル移動 (`moveCursor`: left/right/up/down/home/end)
- 文字入力 (`insertChar`): 全角/半角自動判定
- 削除 (`deleteForward`, `deleteBackward`)
- 範囲選択 (`setSelection`, `getNormalizedSelection`)
- クリップボード (`getSelectedText`, `killLine`, `killSelection`, `paste`)
- スナップショット (`getSnapshot`, `restoreSnapshot`): Undo/Redo 用
- 動的サイズ拡張 (`ensureSize`): 書き込み位置に応じてグリッドを自動拡張
- テキスト変換 (`fromText`, `toText`): 文字列 ↔ セルグリッド

### 9.2 AsciiRenderer — Canvas 描画

Canvas 2D API でバッファの内容を描画する。

```
+------+--------------------------------------------+
|  1   | +--------+     +--------+       <- text    |
|  2   | | Server |---->| Client |                  |
|  3   | +--------+     +--------+                  |
|  4   | #                                <- cursor |
|  5   |                                            |
|      | ################               <- selection|
+------+--------------------------------------------+
  ^-- line number gutter
```

- device pixel ratio 対応 (Retina 等の高解像度ディスプレイ)
- VS Code テーマカラー変数 (`--vscode-editor-*`) を使用
- フォントメトリクスキャッシュ (`cellWidth`, `cellHeight`)
- マウス座標 → グリッドセル変換 (`screenToCell`)

### 9.3 BoxDrawing — 罫線描画

選択範囲に ASCII ボックスを追加/削除する。

```
選択範囲:                addBox() 後:
+-------------+         +----------------+
| Hello World |   -->   | +-----------+  |
|             |         | |Hello World|  |
+-------------+         | +-----------+  |
                        +----------------+
```

- `toggleBox()`: 選択範囲の罫線の有無を切り替え
- `findContainingBox()`: カーソル位置を囲むボックスを検出
- `autoAdjustBox()`: 内容に合わせてボックス幅を自動調整
- ボックス文字: `+` (角), `-` (水平), `|` (垂直)

### 9.4 AsciiEditor — エディタ本体

バッファ・レンダラ・罫線描画を統合する。

**キーバインド (Emacs 風):**

| キー              | 操作                            |
| ----------------- | ------------------------------- |
| `Ctrl+B/F/P/N`    | ← → ↑ ↓ カーソル移動            |
| `Ctrl+A/E`        | 行頭/行末                       |
| `Ctrl+D`          | 前方削除 (Delete)               |
| `Ctrl+H`          | 後方削除 (Backspace)            |
| `Ctrl+K`          | 行末まで削除 (Kill)             |
| `Ctrl+W`          | 選択範囲を削除                  |
| `Ctrl+C/V`        | コピー/ペースト                 |
| `Ctrl+Z/Y`        | Undo/Redo                       |
| `Ctrl+X → Ctrl+S` | 保存 (プレフィックスキー)       |
| `Ctrl+X → Ctrl+R` | 罫線トグル (プレフィックスキー) |

**Undo/Redo:** スナップショットスタック方式 (最大 100 エントリ)

---

## 10. ビルドとテスト

### 10.1 ビルド

esbuild で 2 つのバンドルを同時生成:

| ターゲット | エントリ           | 出力               | 形式 | プラットフォーム |
| ---------- | ------------------ | ------------------ | ---- | ---------------- |
| Extension  | `src/extension.ts` | `out/extension.js` | CJS  | Node.js          |
| WebView    | `webview/main.ts`  | `out/webview.js`   | IIFE | Browser          |

```bash
node esbuild.mjs --development   # 開発ビルド (sourcemap あり)
node esbuild.mjs --production    # 本番ビルド (minify)
node esbuild.mjs --watch         # ウォッチモード
```

### 10.2 テスト

vitest を使用。`vscode` モジュールはテスト用モック (`test/vscode.mock.ts`) にエイリアスされる。

```bash
npx vitest run        # 全テスト実行
npx vitest            # ウォッチモード
```

| テストファイル                | 対象                                     |
| ----------------------------- | ---------------------------------------- |
| `asciiBuffer.test.ts`         | AsciiBuffer の初期化・全角文字・動的拡張 |
| `boxDrawing.test.ts`          | ボックス追加・自動調整                   |
| `keybindings.test.ts`         | キーバインド処理                         |
| `markdownIntegration.test.ts` | ブロック検索・プレースホルダ解析・CRLF   |

### 10.3 TypeScript 設定

| 設定ファイル            | 対象                 | module | lib         |
| ----------------------- | -------------------- | ------ | ----------- |
| `tsconfig.json`         | Extension (`src/`)   | Node16 | ES2022      |
| `tsconfig.webview.json` | WebView (`webview/`) | ES2022 | ES2022, DOM |

---

## 11. Canvas エディタ (未完成)

`webview/canvas/` にベクター図形エディタのスケルトンが存在するが、**Shape 型定義が不足しており動作しない**。

### 11.1 設計意図

```
Canvas エディタ (将来計画)
+-- CanvasEditor.ts    <- 図形の配置・選択・移動・リサイズ
+-- render.ts          <- 図形描画 (plain/sketch/pencil スタイル)
+-- EditorStateMachine <- モード管理 (idle/insert/select/edit)
+-- drawStyle.ts       <- 描画スタイルデフォルト
+-- tools/
    +-- RectTool.ts    <- 矩形ツール
    +-- EllipseTool.ts <- 楕円ツール
    +-- ArrowTool.ts   <- 矢印ツール
    +-- TextTool.ts    <- テキストツール
    +-- TableTool.ts   <- テーブルツール
    +-- SelectTool.ts  <- 選択ツール
```

### 11.2 不足している要素

- `Shape` 型 (判別共用体: `RectShape | EllipseShape | ArrowShape | TextShape | TableShape | ImageShape`)
- 各 Shape クラスのメソッド: `getBounds()`, `clone()`, `translate()`
- `hitTest()`, `nextId()` ユーティリティ
- SVG エクスポート機能
- WebView の `main.ts` への Canvas エディタ統合

---

## 12. 今後の課題

| 優先度 | 項目                                | 状態        |
| ------ | ----------------------------------- | ----------- |
| 高     | ASCII エディタの安定化              | ✅ 完了     |
| 高     | Markdown プレースホルダ追跡         | ✅ 完了     |
| 中     | Canvas エディタの Shape 型定義      | ⬜ 未着手   |
| 中     | SVG エクスポート機能                | ⬜ 未着手   |
| 中     | E2E テストの整備                    | ⬜ 未着手   |
| 低     | UI パネル (EdgeEdit, FillStyleEdit) | ⬜ 未着手   |
| 低     | Web スタンドアロンサーバー          | 🗑️ 削除済み |
| 低     | CLI ツール                          | 🗑️ 削除済み |
