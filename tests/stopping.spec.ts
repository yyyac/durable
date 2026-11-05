import { test, expect } from './fixtures';
import { configureModel } from './configure-model';
const model = { name: '停止测试模型', apiKey: 'stopping-test-key', protocol: 'anthropic-messages' as const, supportsThinking: true };

test('正文阶段主动停止保留已发布内容，取消上游且停止片段不进入下一轮上下文', async ({ page, workbench, upstream }, testInfo) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url.replace(/\/v1$/, ''), model);
  upstream.enqueue({ chunks: [{ thinking: '已经完成的思考。' }, '已经发布的部分正文。', '停止后不应发布的尾段。'], pauseAfter: 1 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('先回答这一题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('已经发布的部分正文。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /思考过程/ }).click();
  await page.screenshot({ path: testInfo.outputPath('body-generating.png') });
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByText('已停止', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('assistant-message')).toHaveCount(1);
  await expect(page.getByText('已经完成的思考。', { exact: true })).toBeVisible();
  await expect(page.getByText('已经发布的部分正文。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('stopped.png') });
  await expect.poll(() => upstream.abortedResponses).toBe(1);
  upstream.release();
  await expect(page.getByText('停止后不应发布的尾段。', { exact: true })).toHaveCount(0);

  upstream.enqueue({ chunks: ['下一轮正常回答。'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('换一个问题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('下一轮正常回答。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(2);
  expect(upstream.requests[1].messages.map((message) => ({ role: message.role, text: typeof message.content === 'string' ? message.content : (message.content as Array<{ text?: string }>).map((block) => block.text ?? '').join('') }))).toEqual([
    { role: 'user', text: '先回答这一题' },
    { role: 'user', text: '换一个问题' },
  ]);
  await page.reload();
  await expect(page.getByText('已停止', { exact: true })).toHaveCount(1);
  await expect(page.getByText('已经发布的部分正文。', { exact: true })).toHaveCount(1);
  await expect(page.getByText('下一轮正常回答。', { exact: true })).toHaveCount(1);
});

test('思考阶段主动停止后保留展开的部分思考并结束计时，不再追加正文', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url.replace(/\/v1$/, ''), model);
  upstream.enqueue({ chunks: [{ thinking: '仍在进行的思考。' }, { thinking: '停止后不能出现的思考。' }, '停止后不能出现的正文。'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请先思考');
  await page.getByRole('button', { name: '发送消息' }).click();
  const thinking = page.getByRole('button', { name: /思考中/ });
  await expect(thinking).toBeVisible();
  await thinking.click();
  await expect(page.getByText('仍在进行的思考。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByRole('button', { name: /思考过程/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /思考中/ })).toHaveCount(0);
  await expect(page.getByText('仍在进行的思考。', { exact: true })).toBeVisible();
  await expect(page.getByText('已停止', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  await expect.poll(() => upstream.abortedResponses).toBe(1);
  upstream.release();
  upstream.enqueue({ chunks: ['重新提问后的答案。'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('直接回答下一题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('重新提问后的答案。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(2);
  expect(upstream.requests[1].messages.map((message) => message.role)).toEqual(['user', 'user']);
  await expect(page.getByText(/停止后不能出现的/)).toHaveCount(0);
  await expect(page.getByTestId('assistant-message')).toHaveCount(2);
});
