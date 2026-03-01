# Markdown SVG Sketch

VS Code 上で Markdown 執筆中にシンプルな図形エディタを使って SVG 図を作成できる拡張機能です。

## 機能

- **WebView ベースの図形エディタ** — サイドパネルで直感的に作図
- **5つの描画ツール** — 四角形、楕円、矢印、テキスト、選択/移動
- **SVG として保存** — `.svg` ファイルとして保存し、Markdown にリンクを自動挿入
- **既存 SVG の再編集** — 保存した SVG をエディタで再度開いて編集可能
- **Undo/Redo** — Ctrl+Z / Ctrl+Y で操作を取り消し・やり直し

## 使い方

### 新しい図を作成

1. Markdown ファイルを開いた状態で、右クリック → **Markdown SVG Sketch: New Diagram**
2. サイドパネルに図形エディタが表示される
3. ツールバーで描画ツールを選択し、キャンバス上で図形を配置
4. **💾 Save** ボタンで SVG を保存 → Markdown にリンクが自動挿入

### 既存の SVG を編集

- エクスプローラーで `.svg` ファイルを右クリック → **Markdown SVG Sketch: Edit SVG**

### キーボードショートカット

| キー | ツール |
|------|--------|
| `V`  | 選択   |
| `R`  | 四角形 |
| `E`  | 楕円   |
| `A`  | 矢印   |
| `T`  | テキスト |
| `Delete` | 選択中の図形を削除 |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |

## 設定

| 設定 | 説明 | デフォルト |
|------|------|-----------|
| `markdown-svg-sketch.imgDir` | SVG 保存先ディレクトリ (Markdown ファイルからの相対パス) | `img` |
| `markdown-svg-sketch.filePrefix` | SVG ファイル名のプレフィックス | `diagram` |

## 開発

```bash
npm install
npm run watch   # 開発時 (自動リビルド)
npm run build   # 本番ビルド
```

## License

MIT
