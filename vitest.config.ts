import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      // Allow webview tests to resolve src/types via the same path
      "@src": path.resolve(__dirname, "src"),
      vscode: path.resolve(__dirname, "test", "vscode.mock.ts"),
    },
  },
});
