import { test, expect } from "@playwright/test";

test.describe("SVG Sketch Web Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("ページが読み込まれてキャンバスが表示される", async ({ page }) => {
    const canvas = page.locator("#canvas");
    await expect(canvas).toBeVisible();
  });

  test("ツールバーのボタンが全て表示される", async ({ page }) => {
    const tools = ["select", "rect", "ellipse", "arrow", "text", "bubble", "table"];
    for (const tool of tools) {
      await expect(page.locator(`button[data-tool="${tool}"]`)).toBeVisible();
    }
  });

  test("ツールボタンをクリックするとアクティブになる", async ({ page }) => {
    const rectBtn = page.locator('button[data-tool="rect"]');
    await rectBtn.click();
    await expect(rectBtn).toHaveClass(/active/);

    // select はアクティブでなくなるはず
    const selectBtn = page.locator('button[data-tool="select"]');
    await expect(selectBtn).not.toHaveClass(/active/);
  });

  test("キーボードショートカットでツール切替", async ({ page }) => {
    await page.keyboard.press("r");
    await expect(page.locator('button[data-tool="rect"]')).toHaveClass(/active/);

    await page.keyboard.press("e");
    await expect(page.locator('button[data-tool="ellipse"]')).toHaveClass(/active/);

    await page.keyboard.press("v");
    await expect(page.locator('button[data-tool="select"]')).toHaveClass(/active/);
  });

  test("矩形を描画できる", async ({ page }) => {
    // Rect ツールに切り替え
    await page.locator('button[data-tool="rect"]').click();

    const canvas = page.locator("#canvas");
    const box = await canvas.boundingBox();
    if (!box) { throw new Error("Canvas not found"); }

    // ドラッグで矩形を描画
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 150);
    await page.mouse.up();

    // ステータスバーやキャンバスの状態を確認（描画後は select ツールに自動切替）
    await expect(page.locator('button[data-tool="select"]')).toHaveClass(/active/);
  });

  test("Stroke / Fill カラーピッカーが機能する", async ({ page }) => {
    const strokeInput = page.locator("#stroke-color");
    await expect(strokeInput).toBeVisible();

    const fillInput = page.locator("#fill-color");
    await expect(fillInput).toBeVisible();
  });

  test("パレット開閉が機能する", async ({ page }) => {
    const paletteBlock = page.locator("#palette-block");
    await expect(paletteBlock).not.toHaveClass(/expanded/);

    await page.locator("#palette-toggle").click();
    await expect(paletteBlock).toHaveClass(/expanded/);

    await page.locator("#palette-toggle").click();
    await expect(paletteBlock).not.toHaveClass(/expanded/);
  });

  test("Undo/Redo ボタンが表示される", async ({ page }) => {
    await expect(page.locator("#btn-undo")).toBeVisible();
    await expect(page.locator("#btn-redo")).toBeVisible();
  });

  test("Save ボタンで API を呼び出す", async ({ page }) => {
    const responsePromise = page.waitForResponse((res) =>
      res.url().includes("/api/save") && res.status() === 200
    );

    await page.locator("#btn-save").click();
    const response = await responsePromise;
    const body = await response.json();
    expect(body).toHaveProperty("ok", true);
  });

  test("Download ボタンが表示される", async ({ page }) => {
    await expect(page.locator("#btn-download")).toBeVisible();
  });

  test("テーブルツールバーは初期状態で非表示", async ({ page }) => {
    const tableToolbar = page.locator("#table-toolbar");
    await expect(tableToolbar).toHaveCSS("visibility", "hidden");
  });
});
