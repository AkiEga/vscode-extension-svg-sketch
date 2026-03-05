# SVG Sketch

[English](./README.md) | 日本語

SVG Sketch は、Canvas ベースのエディタで SVG 図を作成・編集できる VS Code 拡張機能です。

## 機能

- `.svg` ファイル用の Canvas ベースのカスタムエディタ
- 5 種類の描画ツール: 選択、四角形、楕円、矢印、表
- 選択中図形へのラベル挿入・編集 (`F2`)
- エディタから SVG を直接保存・上書き
- 既存 SVG の再編集 (`data-diagram` に図データを埋め込み)
- Undo/Redo とキーボードショートカット
- 選択図形のコピー&ペースト (`Ctrl+C` / `Ctrl+V`)
- グリッドスナップ切り替え (`S`)
- 図テンプレートの保存・挿入・削除

## 使い方

### 新しい SVG を作成

1. コマンドパレットを開く。
2. `SVG Sketch: New SVG` を実行する。
3. ツールバーでツールを選び、キャンバス上で作図する。
4. `Save` を押して SVG を保存する。

### Markdown 執筆中に SVG ファイルを作成

1. コマンドパレットを開く。
2. `SVG Sketch: Create SVG File` を実行する。
3. ファイル名を入力（拡張子なし）。
4. 設定した保存先フォルダに SVG ファイルが作成され、編集画面が開く。
5. **Markdown ファイルから実行した場合、カーソル位置に画像リンクが自動挿入されます。**
6. 作図後、`Save` で保存する。

### 既存 SVG を編集

- VS Code で `.svg` ファイルを開く。
- `*.svg` の既定カスタムエディタとして `SVG Sketch Editor` で開かれる。

### キーボードショートカット

| キー | 操作 |
|---|---|
| `V` | 選択ツール |
| `R` | 四角形ツール |
| `E` | 楕円ツール |
| `A` | 矢印ツール |
| `G` | 表ツール |
| `F2` | 選択図形のラベル/テキスト編集 |
| `S` | グリッドスナップ切り替え |
| `Ctrl+C` | 選択図形をコピー |
| `Ctrl+V` | 図形を貼り付け |
| `Delete` / `Backspace` | 選択中の図形を削除 |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |

## 設定

| 設定 | 説明 | デフォルト |
|---|---|---|
| `svg-sketch.svgOutputDir` | `Create SVG File` コマンドで SVG ファイルを保存するディレクトリ (ワークスペースルートまたは現在のファイルのディレクトリからの相対パス) | `images` |
| `svg-sketch.templateDir` | 図テンプレート保存先ディレクトリ (ワークスペースルートからの相対パス)。空の場合はテンプレート機能が無効になります | `""` (無効) |

## 開発

```bash
npm install
node esbuild.mjs --development
node esbuild.mjs --watch
node esbuild.mjs --production
npx vitest run
```

## License

MIT
