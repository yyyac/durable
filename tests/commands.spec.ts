import { test, expect } from './fixtures';

test('同时发送不同模型的请求时，被拒绝的输入不能改变获准输入使用的模型', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('concurrent-test-key');
  await page.getByLabel('模型 ID', { exact: true }).fill('model-a');
  await page.getByLabel('模型名称', { exact: true }).fill('模型甲');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID 2', { exact: true }).fill('model-b');
  await page.getByLabel('模型名称 2', { exact: true }).fill('模型乙');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByRole('button', { name: '选择模型' })).toHaveText('模型甲');
  const settings = await (await page.request.get(`${workbench.url}/api/settings`)).json();
  const service = settings.services[0];
  const { id } = await (await page.request.get(`${workbench.url}/api/conversation`)).json();
  upstream.enqueue({ chunks: ['获准请求的正文。'], pauseAfter: 0 });
  const responses = await Promise.all(service.models.map((model: { id: string }, index: number) => page.request.post(`${workbench.url}/api/conversations/${id}/messages`, {
    data: { content: `问题${index}`, modelSelection: { serviceId: service.id, modelId: model.id } },
  })));
  const results = responses.map((response) => response.status());
  expect(results.filter((status) => status === 202)).toHaveLength(1);
  expect(results.filter((status) => status === 409)).toHaveLength(1);
  await expect.poll(() => upstream.requests.length).toBe(1);
  const admittedIndex = results.findIndex((status) => status === 202);
  expect(upstream.requests[0].model).toBe(admittedIndex % 2 === 0 ? 'model-a' : 'model-b');
  upstream.release();
  await expect(page.getByTestId('assistant-message')).toHaveText('获准请求的正文。');
  await expect(page.getByTestId('user-message')).toHaveCount(1);
});
