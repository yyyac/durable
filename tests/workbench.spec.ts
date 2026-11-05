import { test, expect } from './fixtures';
import { configureModel } from './configure-model';

test('未配置模型时可以从设置入口开始配置', async ({ page, workbench }) => {
  await page.goto(workbench.url);
  await expect(page.getByRole('heading', { name: '个人 Agent 工作台' })).toBeVisible();
  await expect(page.getByText('尚未配置模型')).toBeVisible();
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('dialog', { name: '模型设置' })).toBeVisible();
  await expect(page.getByLabel('接口地址')).toBeVisible();
});

test('真实回复逐段显示，结束补齐尾段且可以携带有效上下文继续提问', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  upstream.enqueue({ chunks: ['第一段内容', '，完整尾段。'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('你好，请介绍自己');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('第一段内容');
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await expect(page.getByText('思考过程')).toHaveCount(0);
  const conversation = await (await page.request.get(`${workbench.url}/api/conversation`)).json();
  const duplicate = await page.request.post(`${workbench.url}/api/conversations/${conversation.id}/messages`, { data: { content: '不应排队' } });
  expect(duplicate.status()).toBe(409);
  upstream.release();
  await expect(page.getByTestId('assistant-message')).toHaveText('第一段内容，完整尾段。');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(1);
  await page.getByRole('textbox', { name: '输入消息' }).fill('继续说明');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveCount(2);
  await expect(page.getByTestId('assistant-message').last()).toHaveText('测试回复');
  expect(upstream.requests).toHaveLength(2);
  expect(upstream.requests[1].model).toBe('test-model');
  expect(upstream.requests[1].messages.filter((message) => ['user', 'assistant'].includes(message.role))).toEqual([
    { role: 'user', content: '你好，请介绍自己' },
    { role: 'assistant', content: '第一段内容，完整尾段。' },
    { role: 'user', content: '继续说明' },
  ]);
  await page.reload();
  await expect(page.getByTestId('assistant-message')).toHaveCount(2);
  await expect(page.getByTestId('assistant-message').first()).toHaveText('第一段内容，完整尾段。');
});

test('设置保存后只显示脱敏密钥，刷新后仍然保留模型', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('test-secret-do-not-echo');
  await page.getByLabel('模型 ID').fill('test-model');
  await page.getByLabel('模型名称').fill('本地测试模型');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('本地测试模型', { exact: true }).first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('placeholder', '••••••••••••••••');
  await expect(page.getByText('已保存密钥', { exact: false })).toHaveCount(0);
  const summary = await (await page.request.get(`${workbench.url}/api/settings`)).text();
  expect(summary).not.toContain('test-secret-do-not-echo');
  expect(summary).toContain('本地测试模型');
});
