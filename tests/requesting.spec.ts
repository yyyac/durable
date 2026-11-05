import { test, expect } from './fixtures';
import { configureModel } from './configure-model';

test('等待首段内容时显示请求标志，刷新继续等待，收到正文后移除', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const requesting = page.getByRole('status', { name: '正在请求模型', exact: true });
  await expect(requesting).toHaveCount(0);
  upstream.enqueue({ chunks: ['', '首段正文'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请回答');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(requesting).toHaveText('请求中…');
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await expect.poll(() => upstream.requests.length).toBe(1);
  await page.reload();
  await expect(requesting).toHaveText('请求中…');
  upstream.release();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('首段正文');
  await expect(requesting).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(1);
});

test('首段思考出现后移除请求标志，等待阶段停止也会移除', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url, { supportsThinking: true });
  const requesting = page.getByRole('status', { name: '正在请求模型', exact: true });
  upstream.enqueue({ chunks: ['', { thinking: '先分析条件' }, '答复正文'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请先思考');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(requesting).toBeVisible();
  await expect.poll(() => upstream.requests.length).toBe(1);
  upstream.release();
  await expect(page.getByRole('button', { name: /思考中|思考过程/ })).toBeVisible();
  await expect(requesting).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  upstream.enqueue({ chunks: ['', '不应显示的正文'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('这次停止');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(requesting).toBeVisible();
  await expect.poll(() => upstream.requests.length).toBe(2);
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(requesting).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  upstream.release();
  await expect(page.getByText('不应显示的正文', { exact: true })).toHaveCount(0);
});

test('请求失败移除等待标志，重试时重新显示', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const requesting = page.getByRole('status', { name: '正在请求模型', exact: true });
  upstream.enqueue({ chunks: [], failure: { status: 401, message: '请求凭据无效' } });
  await page.getByRole('textbox', { name: '输入消息' }).fill('稍后重试');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('alert')).toContainText('请求凭据无效');
  await expect(requesting).toHaveCount(0);
  upstream.enqueue({ chunks: ['', '重试成功'], pauseAfter: 0 });
  await page.getByRole('button', { name: '重试回复' }).click();
  await expect(requesting).toBeVisible();
  await expect.poll(() => upstream.requests.length).toBe(2);
  upstream.release();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('重试成功');
  await expect(requesting).toHaveCount(0);
});
