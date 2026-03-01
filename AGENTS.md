# Project Guidelines — Markdown SVG Sketch

VS Code 拡張機能。Markdown 執筆中に SVG 形式の図を Canvas ベースのエディタで作成・編集する。

## Architecture

```
src/          Extension 側 (Node, CJS)  — コマンド登録・WebView 管理・ファイル保存・SVG エクスポート
webview/      WebView 側 (Browser, IIFE) — CanvasEditor・描画ツール・UI
test/         ユニットテスト (vitest)
```

- Extension ↔ WebView は `postMessage` で通信。共有型は `src/types.ts` に定義し `webview/shared.ts` で re-export。
- 図形は判別共用体 `Shape = RectShape | EllipseShape | ArrowShape | TextShape | TableShape`。
- 各描画ツールは `Tool` インタフェース (`onMouseDown / onMouseMove / onMouseUp / getPreview`) を実装。
- SVG 再編集用のメタデータは `data-diagram` 属性に JSON で埋め込む。
- 詳細設計は [.github/DESIGN.md](.github/DESIGN.md)、要件は [.github/REQUIREMENTS.md](.github/REQUIREMENTS.md) を参照。

## Build & Test

```bash
node esbuild.mjs --development   # 開発ビルド (extension.js + webview.js)
node esbuild.mjs --production    # 本番ビルド (minify)
node esbuild.mjs --watch         # ウォッチモード
npx vitest run                   # テスト実行
npx vitest                       # テスト (watch)
```

esbuild は 2 ターゲット (Node `out/extension.js` / Browser `out/webview.js`) を同時にバンドルする。

## Code Style

- TypeScript strict モード。
- Extension 側: `tsconfig.json` (`module: Node16`, `rootDir: src`)。
- WebView 側: `tsconfig.webview.json` (`module: ES2022`, `lib: ES2022, DOM`)。
- 日本語コメント可。ただしコード・識別子は英語。
- `src/types.ts` の型を webview から直接 import しない — `webview/shared.ts` 経由で使うこと。

## Conventions

- 新しい図形ツールを追加する場合: `webview/canvas/tools/` にツールクラスを作成し `Tool` インタフェースを実装。`src/types.ts` に Shape 型を追加。`svgExporter.ts` に SVG 変換ロジックを追加。`render.ts` に Canvas 描画ロジックを追加。
- テストは `test/` に `*.test.ts` で配置。vitest globals (`describe`, `it`, `expect`) を使用。
- WebView の CSS は `src/diagramPanel.ts` 内にインラインで記述。
- ファイルパスは POSIX 正規化してクロスプラットフォーム対応すること。
