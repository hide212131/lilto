const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

async function verifyClipboardImages(page, writeClipboard) {
  await page.locator('lilt-top-bar').getByTitle('New', { exact: true }).click();
  const composer = page.locator('lilt-composer');
  const input = composer.locator('textarea');
  await writeClipboard();
  await input.focus();
  await input.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await composer.locator('.attachment img').waitFor();
  assert.equal(await composer.locator('.attachment img').count(), 1);
  await composer.getByRole('button', { name: '画像 1 を削除', exact: true }).click();
  assert.equal(await composer.locator('.attachment img').count(), 0);
  await input.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await composer.locator('.attachment img').waitFor();
  await page.screenshot({ path: path.join(__dirname, '../test/artifacts/clipboard-images-preview.png') });
  await composer.getByRole('button', { name: '送信', exact: true }).click();
  await page.locator('.msg-user .message-image').last().waitFor();
  await page.waitForFunction(() => {
    const app = document.querySelector('lilt-app');
    return !app.isSending && app.messages.some((m) => m.role === 'assistant' && m.text.includes('E2E_MOCK_FINAL'));
  });
  assert.equal(await composer.locator('.attachment img').count(), 0);
  const errors = await page.locator('.msg-error').allTextContents();
  assert.deepEqual(errors, []);
  const dataUrl = await page.locator('.msg-user .message-image').last().getAttribute('src');
  const imageFile = { name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
  const chooserPromise = page.waitForEvent('filechooser');
  await composer.getByRole('button', { name: '画像を添付', exact: true }).click();
  await (await chooserPromise).setFiles([imageFile, imageFile]);
  await page.waitForFunction(() => document.querySelector('lilt-app').shadowRoot.querySelector('lilt-composer').shadowRoot.querySelectorAll('.attachment img').length === 2);
  await input.fill('画像を説明してください');
  await composer.getByRole('button', { name: '送信', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('lilt-app').isSending);
  assert.equal(await page.locator('.msg-user').last().locator('.message-image').count(), 2);
  assert.match(await page.locator('.msg-user').last().textContent(), /画像を説明してください/);
  await composer.locator('input[type="file"]').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await composer.getByRole('alert').waitFor();
  assert.equal(await composer.locator('.attachment img').count(), 0);
  console.log('✓ Clipboard paste, preview, remove, image-only send, picker and text with multiple images');
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilto-clipboard-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ activeProvider: 'custom-openai-completions', customProvider: { name: 'Test', baseUrl: 'http://localhost:11434/v1', apiKey: 'test', modelId: 'test-model' } }));
  const env = { ...process.env, LILTO_E2E_MOCK: '1', LILTO_PROVIDER_SETTINGS_PATH: settingsPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${dir}`, '--remote-debugging-port=9337'], env });
  try {
    const page = await app.firstWindow();
    await page.locator('lilt-composer textarea').waitFor();
    await page.waitForFunction(() => !document.querySelector('lilt-app').shadowRoot.querySelector('lilt-composer').disabled);
    require('node:child_process').execFileSync(process.execPath, ['scripts/live-ui-manual-verification.js', '9337', 'status-text'], { stdio: 'inherit' });
    await verifyClipboardImages(page, () => app.evaluate(async ({ clipboard, nativeImage, ClipboardItem }) => {
      const bitmap = Buffer.alloc(32 * 32 * 4);
      for (let i = 0; i < bitmap.length; i += 4) { bitmap[i] = 180; bitmap[i + 1] = 120; bitmap[i + 2] = 30; bitmap[i + 3] = 255; }
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([nativeImage.createFromBitmap(bitmap, { width: 32, height: 32 }).toPNG()], { type: 'image/png' }) })]);
    }));
    await page.screenshot({ path: path.join(__dirname, '../test/artifacts/clipboard-images-sent.png') });
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { verifyClipboardImages };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
