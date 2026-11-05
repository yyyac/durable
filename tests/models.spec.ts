import { test, expect } from './fixtures';
import { ProtocolUpstream } from './model-upstream';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('已有单模型文件仍可使用，留空密钥保存后继续保留原配置', async ({ page, workbench, upstream }) => {
  await workbench.stop();
  await writeFile(join(workbench.dataDir, 'models.json'), JSON.stringify({ baseUrl: upstream.url, apiKey: 'old-model-secret', modelId: 'test-model', name: '原有模型' }));
  await workbench.start();
  await page.goto(workbench.url);
  await expect(page.getByRole('button', { name: '选择模型' })).toHaveText('原有模型');
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await page.getByLabel('模型名称', { exact: true }).fill('保留旧密钥的模型');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByRole('button', { name: '选择模型' })).toHaveText('保留旧密钥的模型');
  await workbench.stop(); await workbench.start(); await page.reload();
  await expect(page.getByRole('button', { name: '选择模型' })).toHaveText('保留旧密钥的模型');
  await page.getByRole('textbox', { name: '输入消息' }).fill('继续使用已有配置');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('测试回复');
  const summary = await (await page.request.get(`${workbench.url}/api/settings`)).text();
  expect(summary).not.toContain('old-model-secret');
});

test('移除所有模型后明确提示未配置并可重新进入设置', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('test-delete-key');
  await page.getByLabel('模型 ID', { exact: true }).fill('model-a');
  await page.getByLabel('模型名称', { exact: true }).fill('将移除的模型');
  await page.getByRole('button', { name: '保存配置' }).click();
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '移除模型', exact: true }).click();
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('尚未配置模型', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '选择模型' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('尚未配置模型', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await expect(page.getByLabel('模型 ID', { exact: true })).toBeVisible();
});

test('通过设置选择三种协议并向各自自定义地址发送真实请求', async ({ page, workbench }) => {
  const upstream = new ProtocolUpstream();
  await upstream.start();
  try {
    await page.goto(workbench.url);
    await page.getByRole('button', { name: '打开设置' }).click();
    const services = [
      { name: '聊天协议服务', protocol: 'openai-completions', suffix: 'chat', model: 'chat-model' },
      { name: '响应协议服务', protocol: 'openai-responses', suffix: 'responses', model: 'response-model' },
      { name: '消息协议服务', protocol: 'anthropic-messages', suffix: 'anthropic', model: 'anthropic-model' },
    ];
    for (const [index, service] of services.entries()) {
      if (index) await page.getByRole('button', { name: '添加模型服务', exact: true }).click();
      await page.getByLabel('服务名称').fill(service.name);
      await page.getByLabel('接口协议').selectOption(service.protocol);
      await page.getByLabel('接口地址').fill(`${upstream.url}/custom/${service.suffix}`);
      await page.getByLabel('API Key', { exact: true }).fill(`key-${service.suffix}`);
      await page.getByLabel('模型 ID', { exact: true }).fill(service.model);
      await page.getByLabel('模型名称', { exact: true }).fill(service.model);
    }
    await page.getByRole('button', { name: '保存配置' }).click();
    for (const [index, service] of services.entries()) {
      await page.getByRole('button', { name: '选择模型' }).click();
      await page.getByRole('menuitemradio', { name: service.model, exact: true }).click();
      await expect(page.getByRole('button', { name: '选择模型' })).toHaveText(service.model);
      await page.getByRole('textbox', { name: '输入消息' }).fill(`使用 ${service.model}`);
      await page.getByRole('button', { name: '发送消息' }).click();
      await expect(page.getByTestId('assistant-message').last()).toContainText(`已连接 ${service.model}`);
      await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
      expect(upstream.requests).toHaveLength(index + 1);
      expect(upstream.requests[index].body.model).toBe(service.model);
    }
    expect(upstream.requests.map((request) => request.path)).toEqual(['/custom/chat/chat/completions', '/custom/responses/responses', '/custom/anthropic/v1/messages']);
    expect(upstream.requests[0].authorization).toBe('Bearer key-chat');
    expect(upstream.requests[1].authorization).toBe('Bearer key-responses');
    expect(upstream.requests[2].apiKey).toBe('key-anthropic');
    expect(upstream.requests[1].body.input).toBeDefined();
    expect(upstream.requests[2].body.messages).toBeDefined();
  } finally { upstream.close(); }
});

test('切换模型只作用于后续回复，生成中的请求和会话历史保持原样', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('test-model-key');
  await page.getByLabel('模型 ID', { exact: true }).fill('model-a');
  await page.getByLabel('模型名称', { exact: true }).fill('模型 A');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID 2', { exact: true }).fill('model-b');
  await page.getByLabel('模型名称 2', { exact: true }).fill('模型 B');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByRole('button', { name: '选择模型' })).toBeVisible();
  upstream.enqueue({ chunks: ['原模型片段', '，原模型尾段'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('第一个问题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('原模型片段');
  await page.getByRole('button', { name: '选择模型' }).click();
  await page.getByRole('menuitemradio', { name: '模型 B', exact: true }).click();
  expect(upstream.requests).toHaveLength(1);
  expect(upstream.requests[0].model).toBe('model-a');
  upstream.release();
  await expect(page.getByTestId('assistant-message')).toHaveText('原模型片段，原模型尾段');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  await page.getByRole('textbox', { name: '输入消息' }).fill('第二个问题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('测试回复');
  expect(upstream.requests).toHaveLength(2);
  expect(upstream.requests[1].model).toBe('model-b');
  expect(upstream.requests[1].messages.filter((message) => ['user', 'assistant'].includes(message.role))).toEqual([
    { role: 'user', content: '第一个问题' }, { role: 'assistant', content: '原模型片段，原模型尾段' }, { role: 'user', content: '第二个问题' },
  ]);
});

test('设置页保存多个模型服务与模型，重启后仍只显示脱敏密钥', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('服务名称').fill('聊天服务');
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('test-service-secret');
  await page.getByLabel('模型 ID', { exact: true }).fill('chat-a');
  await page.getByLabel('模型名称', { exact: true }).fill('聊天模型 A');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID 2', { exact: true }).fill('chat-b');
  await page.getByLabel('模型名称 2', { exact: true }).fill('聊天模型 B');
  await page.getByRole('button', { name: '添加模型服务', exact: true }).click();
  await page.getByLabel('服务名称').fill('推理服务');
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('tiny');
  await page.getByLabel('模型 ID', { exact: true }).fill('reasoner');
  await page.getByLabel('模型名称', { exact: true }).fill('推理模型');
  await page.getByLabel('支持思考内容', { exact: true }).check();
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByRole('dialog', { name: '模型设置' })).toHaveCount(0);
  await workbench.stop();
  await workbench.start();
  await page.reload();
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('button', { name: '聊天服务', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '推理服务', exact: true })).toBeVisible();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '推理服务', exact: true }).click();
  await expect(page.getByLabel('支持思考内容', { exact: true })).toBeChecked();
  await expect(page.getByText('已保存密钥：••••', { exact: true })).toBeVisible();
  const summary = await (await page.request.get(`${workbench.url}/api/settings`)).text();
  expect(summary).not.toContain('test-service-secret');
  expect(summary).not.toContain('tiny');
  expect(summary).toContain('chat-b');
});
