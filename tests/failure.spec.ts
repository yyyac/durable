import { test, expect } from './fixtures';

async function configure(page: import('@playwright/test').Page, url: string, thinking = false) {
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('接口地址').fill(url);
  await page.getByLabel('API Key', { exact: true }).fill('failure-test-secret');
  await page.getByLabel('模型 ID').fill('test-model');
  await page.getByLabel('模型名称').fill('失败测试模型');
  if (thinking) {
    await page.getByLabel('接口协议').selectOption('anthropic-messages');
    await page.getByLabel('支持思考内容').check();
  }
  await page.getByRole('button', { name: '保存配置' }).click();
}

test('请求失败可阅读原因，手动重试不重复问题或启动重叠生成', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configure(page, upstream.url);
  upstream.enqueue({ chunks: [], failure: { status: 401, message: '请求凭据无效，请检查模型服务' } });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请回答原来的问题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('alert')).toContainText('回复失败');
  await expect(page.getByRole('alert')).toContainText('请求凭据无效');
  await expect(page.getByRole('alert').getByText('回复失败：请求凭据无效，请检查模型服务', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('请求凭据无效');
  await page.screenshot({ path: 'C:/Users/yyya/.codex/visualizations/2026/11/05/01a1aa98-cbf6-74a3-b305-5cdf00994c45/ticket7-empty-failure.png' });
  upstream.enqueue({ chunks: ['重试的完整答案', '，只有一次。'], pauseAfter: 0 });
  await page.getByRole('button', { name: '重试回复' }).dblclick();
  await expect(page.getByTestId('assistant-message').last()).toContainText('重试的完整答案');
  const conversation = await (await page.request.get(`${workbench.url}/api/conversation`)).json();
  const duplicate = await page.request.post(`${workbench.url}/api/conversations/${conversation.id}/retry`);
  expect(duplicate.status()).toBe(409);
  expect(upstream.requests).toHaveLength(2);
  upstream.release();
  await expect(page.getByText('重试的完整答案，只有一次。', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '重试回复' })).toHaveCount(0);
  await expect(page.getByTestId('user-message')).toHaveCount(1);
  expect(upstream.requests[1].messages.filter((message) => message.role === 'user')).toEqual([{ role: 'user', content: '请回答原来的问题' }]);
  const completed = await page.request.post(`${workbench.url}/api/conversations/${conversation.id}/retry`);
  expect(completed.status()).toBe(409);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(upstream.requests).toHaveLength(2);
});

test('中途流失败保留已展开思考和部分正文，恢复上游后手动重试成功', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configure(page, upstream.url, true);
  upstream.enqueue({ chunks: [{ thinking: '已经产生的可见思考' }, '未完成的正文'], pauseAfter: 1, streamError: '输出被上游拒绝' });
  await page.getByRole('textbox', { name: '输入消息' }).fill('这次先思考再回答');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('未完成的正文', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /思考过程/ }).click();
  await expect(page.getByText('已经产生的可见思考', { exact: true })).toBeVisible();
  upstream.release();
  await expect(page.getByRole('alert')).toContainText('输出被上游拒绝');
  await expect(page.getByText('未完成的正文', { exact: true })).toBeVisible();
  await expect(page.getByText('已经产生的可见思考', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(1);
  await page.screenshot({ path: 'C:/Users/yyya/.codex/visualizations/2026/11/05/01a1aa98-cbf6-74a3-b305-5cdf00994c45/ticket7-partial-failure.png' });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('输出被上游拒绝');
  await page.getByRole('button', { name: /思考过程/ }).click();
  await expect(page.getByText('已经产生的可见思考', { exact: true })).toBeVisible();
  upstream.enqueue({ chunks: ['恢复后完整答复。'] });
  await page.getByRole('button', { name: '重试回复' }).click();
  await expect(page.getByText('恢复后完整答复。', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(2);
  expect(upstream.requests[1].messages).toHaveLength(1);
  expect(upstream.requests[1].messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: '这次先思考再回答' }] });
  await expect(page.getByTestId('user-message')).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('未完成的正文', { exact: true })).toBeVisible();
  await expect(page.getByText('恢复后完整答复。', { exact: true })).toHaveCount(1);
  await expect(page.getByText(/回复失败：.*输出被上游拒绝/)).toHaveCount(1);
});
