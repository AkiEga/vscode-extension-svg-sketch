import * as esbuild from "esbuild";

const isProduction = process.argv.includes("--production");
const isWatch = process.argv.includes("--watch");

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  sourcemap: !isProduction,
  minify: isProduction,
  target: "node20",
  loader: { ".svg": "text" },
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ["webview/main.ts"],
  bundle: true,
  outfile: "out/webview.js",
  format: "iife",
  platform: "browser",
  sourcemap: !isProduction,
  minify: isProduction,
  target: "es2022",
  loader: { ".svg": "text" },
};

/** @type {esbuild.BuildOptions} */
const cliConfig = {
  entryPoints: ["cli/svg-sketch-cli.ts"],
  bundle: true,
  outfile: "out/svg-sketch-cli.js",
  format: "cjs",
  platform: "node",
  sourcemap: !isProduction,
  minify: isProduction,
  target: "node20",
  loader: { ".svg": "text" },
};

/** @type {esbuild.BuildOptions} */
const webAppConfig = {
  entryPoints: ["web/client.ts"],
  bundle: true,
  outfile: "out/web-client.js",
  format: "iife",
  platform: "browser",
  sourcemap: !isProduction,
  minify: isProduction,
  target: "es2022",
  loader: { ".svg": "text" },
};

async function main() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    const cliCtx = await esbuild.context(cliConfig);
    const webAppCtx = await esbuild.context(webAppConfig);
    await Promise.all([extCtx.watch(), webCtx.watch(), cliCtx.watch(), webAppCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
      esbuild.build(cliConfig),
      esbuild.build(webAppConfig),
    ]);
    console.log("Build complete.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
