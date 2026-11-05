import { openModelSettings, saveModelSettings } from './configure-model';
import { test, expect } from './fixtures';

test('后端真实崩溃后保留历史并自动恢复未完成回复，完成任务不重新生成', async ({ page, workbench, upstream }) => {
  test.setTimeout(45_000);
  await page.goto(workbench.url);
  await openModelSettings(page);
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('recovery-test-secret');
  await page.getByLabel('模型 ID').fill('test-model');
  await page.getByLabel('模型名称').fill('恢复测试模型');
  await saveModelSettings(page);

  upstream.enqueue({ chunks: ['已经完成的历史答案。'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('历史问题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('已经完成的历史答案。');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();

  upstream.enqueue({ chunks: ['重启前已发布的片段', '，旧连接不会继续。'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('请恢复这一题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('重启前已发布的片段');
  // 流式片段最多延迟一秒落盘，崩溃前留出完整的持久化窗口。
  await page.waitForTimeout(1_100);
  await workbench.crash();
  await expect(page.getByRole('status')).toContainText('连接已断开');

  upstream.enqueue({ chunks: ['恢复后的完整答案', '，终态尾段。'], pauseAfter: 0 });
  await workbench.start();
  await expect.poll(() => upstream.requests.length, { timeout: 12_000 }).toBe(3);
  await expect(page.getByTestId('assistant-message').last()).toHaveText('恢复后的完整答案');
  await expect(page.getByText('已经完成的历史答案。', { exact: true })).toHaveCount(1);
  expect(upstream.requests[2].messages.filter((message) => message.role === 'user')).toEqual([
    { role: 'user', content: '历史问题' },
    { role: 'user', content: '请恢复这一题' },
  ]);
  upstream.release();
  await expect(page.getByText('恢复后的完整答案，终态尾段。', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  await expect(page.getByTestId('user-message')).toHaveCount(2);

  await workbench.crash();
  await workbench.start();
  await page.reload();
  await expect(page.getByText('已经完成的历史答案。', { exact: true })).toHaveCount(1);
  await expect(page.getByText('恢复后的完整答案，终态尾段。', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(3);
  await openModelSettings(page);
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('模型名称')).toHaveValue('恢复测试模型');
});
