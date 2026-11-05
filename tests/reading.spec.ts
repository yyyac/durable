import { test, expect } from './fixtures';

async function configure(page: import('@playwright/test').Page, url: string, thinking = false, protocol = 'openai-completions') {
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('接口地址').fill(url);
  await page.getByLabel('API Key', { exact: true }).fill('reading-test-key');
  await page.getByLabel('模型 ID').fill('test-model');
  await page.getByLabel('模型名称').fill('阅读测试模型');
  await page.getByLabel('接口协议').selectOption(protocol);
  if (thinking) await page.getByRole('checkbox', { name: '支持思考内容' }).check();
  await page.getByRole('button', { name: '保存配置' }).click();
}

test('真实思考默认折叠，展开后持续增长并在完成时保留展开与耗时', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configure(page, upstream.url, true);
  upstream.enqueue({ chunks: [{ thinking: '先核实条件。' }, { thinking: '再检查边界。' }, '这是最终正文。'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请说明条件');
  await page.getByRole('button', { name: '发送消息' }).click();
  const thinking = page.getByRole('button', { name: /思考中/ });
  await expect(thinking).toBeVisible();
  await expect(thinking).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('先核实条件。', { exact: true })).toBeHidden();
  await thinking.click();
  await expect(page.getByText('先核实条件。', { exact: true })).toBeVisible();
  await expect(thinking).toContainText(/\d+s/);
  upstream.release();
  await expect(page.getByText('先核实条件。再检查边界。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /思考过程/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /思考过程/ })).toContainText(/\d+s/);
  await expect(page.getByTestId('assistant-message')).toContainText('这是最终正文。');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests[0].reasoning_effort).toBe('medium');
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('checkbox', { name: '支持思考内容' })).toBeChecked();
});

test('交错内容保持真实顺序，分段 Markdown 补齐并可分别复制正文和代码', async ({ page, context, workbench, upstream }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(workbench.url);
  await configure(page, upstream.url.replace(/\/v1$/, ''), true, 'anthropic-messages');
  upstream.enqueue({ chunks: [{ thinking: '第一段思考。' }, '> **引用正文**\n\n- 第一项\n', { thinking: '第二段思考。' }, '```ts\nconst answer =', ' 42;\n```\n\n完成尾段。'], pauseAfter: 3 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请给出带代码的说明');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect.poll(() => upstream.requests.length).toBe(1);
  await expect(page.locator('blockquote strong')).toHaveText('引用正文');
  await expect(page.locator('li')).toHaveText('第一项');
  await expect(page.locator('pre code')).toHaveText('const answer =');
  upstream.release();
  await expect(page.locator('pre code')).toHaveText('const answer = 42;\n');
  await expect(page.getByText('完成尾段。', { exact: true })).toBeVisible();
  const thoughts = page.getByRole('button', { name: /思考过程/ });
  await expect(thoughts).toHaveCount(2);
  await thoughts.nth(0).click();
  await thoughts.nth(1).click();
  const content = await page.getByTestId('assistant-message').innerText();
  expect(content.indexOf('第一段思考。')).toBeLessThan(content.indexOf('引用正文'));
  expect(content.indexOf('引用正文')).toBeLessThan(content.indexOf('第二段思考。'));
  expect(content.indexOf('第二段思考。')).toBeLessThan(content.indexOf('const answer'));
  await page.screenshot({ path: 'test-results/reading-multiple-blocks.png' });
  await page.getByRole('button', { name: '复制代码' }).click();
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe('const answer = 42;\n');
  await page.getByRole('button', { name: '复制正文' }).click();
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe('> **引用正文**\n\n- 第一项\n\n\n```ts\nconst answer = 42;\n```\n\n完成尾段。');
});

test('仅有加密删减思考时只显示正文，不展示占位或空思考区域', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configure(page, upstream.url.replace(/\/v1$/, ''), true, 'anthropic-messages');
  upstream.enqueue({ chunks: [{ redacted: 'opaque-signature-not-visible' }, '只有可见正文。'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请简要回答');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('只有可见正文。');
  await expect(page.getByRole('button', { name: /思考中|思考过程/ })).toHaveCount(0);
  await expect(page.getByText('[Reasoning redacted]', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
});

test('跟随回复增长滚动，向上阅读后不会被后续输出拉回底部', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configure(page, upstream.url);
  const paragraphs = Array.from({ length: 35 }, (_, index) => `这是第${index + 1}段正文，保留足够长度以检查阅读位置。`).join('\n\n');
  upstream.enqueue({ chunks: [paragraphs, '\n\n后来追加的完整尾段。'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请提供长篇说明');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('这是第35段正文，保留足够长度以检查阅读位置。', { exact: true })).toBeInViewport();
  await page.getByTestId('assistant-message').hover();
  await page.mouse.wheel(0, -10000);
  await expect(page.getByText('这是第1段正文，保留足够长度以检查阅读位置。', { exact: true })).toBeInViewport();
  upstream.release();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  await expect(page.getByText('这是第1段正文，保留足够长度以检查阅读位置。', { exact: true })).toBeInViewport();
  await expect(page.getByText('后来追加的完整尾段。', { exact: true })).not.toBeInViewport();
});
