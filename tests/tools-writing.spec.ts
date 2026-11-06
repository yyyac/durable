import { revealTool } from './tool-details';
import { readFile, rename, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { configureModel } from './configure-model';
import { crashAfterFileEffect } from './write-effect';
import { DEFAULT_RESTART_LIMIT, DEFAULT_RETRY_POLICY } from '@earendil-works/pi-durable';

test('启用后模型能在普通会话目录创建真实新文件，已有同名文件不会被覆盖', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await page.request.post(`${workbench.url}/api/local-tools/enable`);
  await page.reload();
  upstream.enqueue({ chunks: [{ toolCall: { id: 'create-new', name: 'write', arguments: '{"path":"new.txt","content":"首次真实写入"}' } }] });
  upstream.enqueue({ chunks: ['新文件已创建'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('创建 new.txt');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('新文件已创建');
  expect(await readFile(join(conversation.defaultDirectory, 'new.txt'), 'utf8')).toBe('首次真实写入');
  await (await revealTool(page, /write new.txt 已完成/)).click();
  await expect(page.getByTestId('tool-output')).toContainText('new.txt');
  upstream.enqueue({ chunks: [{ toolCall: { id: 'do-not-overwrite', name: 'write', arguments: '{"path":"new.txt","content":"不应覆盖"}' } }] });
  upstream.enqueue({ chunks: ['目标已存在，已保留原内容'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('再次创建同名文件');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('目标已存在，已保留原内容');
  await expect(page.getByRole('button', { name: /write new.txt 失败/, includeHidden: true })).toHaveCount(1);
  expect(await readFile(join(conversation.defaultDirectory, 'new.txt'), 'utf8')).toBe('首次真实写入');
  expect(JSON.stringify(upstream.requests[3].messages)).toContain('当前会话成功读取');
});

test('写入已产生真实文件效果后崩溃会持久等待确认，停止本轮不重放或继续模型', async ({ page, workbench, upstream }) => {
  test.setTimeout(60_000);
  await page.goto(workbench.url);
  await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await page.request.post(`${workbench.url}/api/local-tools/enable`);
  await page.reload();
  const effect = crashAfterFileEffect(workbench, conversation.defaultDirectory, 'uncertain.txt');
  try {
    upstream.enqueue({ chunks: [{ toolCall: { id: 'uncertain-write', name: 'write', arguments: JSON.stringify({ path: 'uncertain.txt', content: 'x'.repeat(4 * 1024 * 1024) }) } }], delayMs: 0 });
    await page.getByRole('textbox', { name: '输入消息' }).fill('创建文件后处理中断');
    await page.getByRole('button', { name: '发送消息' }).click();
    expect(await effect.crashed).toBeGreaterThan(0);
    const before = await readFile(join(conversation.defaultDirectory, 'uncertain.txt'));
    await workbench.start();
    await page.reload();
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible();
    expect(upstream.requests).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '停止本轮', exact: true }).click();
    await expect(page.getByRole('button', { name: /write uncertain.txt 已停止/, includeHidden: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    expect(await readFile(join(conversation.defaultDirectory, 'uncertain.txt'))).toEqual(before);
    expect(upstream.requests).toHaveLength(1);
  } finally { effect.close(); }
});

test('确认重试重新检查同名文件，并发重复确认只执行一次原调用且模型收到真实重试结果', async ({ page, workbench, upstream }) => {
  test.setTimeout(90_000);
  await page.goto(workbench.url);
  await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await page.request.post(`${workbench.url}/api/local-tools/enable`);
  await page.reload();
  const content = 'y'.repeat(4 * 1024 * 1024);
  const path = join(conversation.defaultDirectory, 'retry.txt');
  const effect = crashAfterFileEffect(workbench, conversation.defaultDirectory, 'retry.txt');
  try {
    upstream.enqueue({ chunks: [{ toolCall: { id: 'retry-write', name: 'write', arguments: JSON.stringify({ path: 'retry.txt', content }) } }], delayMs: 0 });
    upstream.enqueue({ chunks: ['确认后继续回复'] });
    await page.getByRole('textbox', { name: '输入消息' }).fill('创建后需要恢复的文件');
    await page.getByRole('button', { name: '发送消息' }).click();
    await effect.crashed;
    await workbench.start();
    await page.reload();
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible({ timeout: 12_000 });
    await page.getByRole('button', { name: '确认重试', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('已存在');
    expect(upstream.requests).toHaveLength(1);
    await rename(path, `${path}.original`);
    const posted = page.waitForRequest((request) => request.url().endsWith('/retry') && request.method() === 'POST');
    await page.getByRole('button', { name: '确认重试', exact: true }).click();
    const request = await posted;
    const duplicate = await page.request.post(request.url(), { data: request.postDataJSON() });
    expect(duplicate.ok()).toBe(true);
    await expect(page.getByTestId('assistant-message').last()).toHaveText('确认后继续回复', { timeout: 20_000 });
    expect(await readFile(path, 'utf8')).toBe(content);
    const toolResult = upstream.requests[1].messages.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolResult)).toContain('Successfully wrote to retry.txt');
    expect(JSON.stringify(toolResult)).not.toContain('was interrupted');
    expect(upstream.requests).toHaveLength(2);
    expect((await page.request.post(request.url(), { data: request.postDataJSON() })).ok()).toBe(true);
    await workbench.crash();
    await workbench.start();
    await page.reload();
    await expect(page.getByRole('button', { name: /write retry.txt 已完成/, includeHidden: true })).toHaveCount(1);
    expect(upstream.requests).toHaveLength(2);
  } finally { effect.close(); }
});

test('工作区待确认跨重启和其他会话调度保留，原运行结束后确认仍遵守十个运行名额', async ({ page, workbench, upstream }) => {
  test.setTimeout(120_000);
  await page.goto(workbench.url);
  await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
  const directory = join(workbench.dataDir, 'shared-workspace');
  await mkdir(directory);
  const workspace = await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json();
  await page.goto(`${workbench.url}/conversations/${workspace.conversation.id}`);
  const content = 'w'.repeat(4 * 1024 * 1024);
  const effect = crashAfterFileEffect(workbench, directory, 'workspace-pending.txt');
  try {
    upstream.enqueue({ chunks: [{ toolCall: { id: 'workspace-write', name: 'write', arguments: JSON.stringify({ path: 'workspace-pending.txt', content }) } }], delayMs: 0 });
    await page.getByRole('textbox', { name: '输入消息' }).fill('工作区写入后等待确认');
    await page.getByRole('button', { name: '发送消息' }).click();
    await effect.crashed;
    await workbench.start();
    await page.reload();
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole('status', { name: '待确认', exact: true })).toBeVisible();
    const original = await readFile(join(directory, 'workspace-pending.txt'));
    const other = await (await page.request.post(`${workbench.url}/api/conversations`)).json();
    for (let round = 0; round <= DEFAULT_RESTART_LIMIT; round++) {
      await workbench.crash();
      await workbench.start();
      await page.reload();
      await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible();
      upstream.enqueue({ chunks: [`其他会话第${round}次正常完成`] });
      expect((await page.request.post(`${workbench.url}/api/conversations/${other.id}/messages`, { data: { content: `其他会话第${round}次发送` } })).status()).toBe(202);
      await expect.poll(() => upstream.finishedResponses).toBe(round + 2);
      expect(upstream.requests).toHaveLength(round + 2);
      expect(await readFile(join(directory, 'workspace-pending.txt'))).toEqual(original);
      // 恢复请求采用指数退避，等下一次请求真正开始，避免仅在休眠阶段反复重启。
      if (round < DEFAULT_RETRY_POLICY.maxRetries) await page.waitForTimeout(DEFAULT_RETRY_POLICY.baseDelayMs * 2 ** round + 1000);
    }
    const publicState = await page.evaluate((id) => new Promise<{ failure?: unknown }>((resolve) => {
      const source = new EventSource(`/api/conversations/${id}/events`);
      source.addEventListener('state', (event) => { source.close(); resolve(JSON.parse(event.data)); });
    }), workspace.conversation.id);
    expect(publicState.failure).toBeTruthy();
    expect((await page.request.post(`${workbench.url}/api/conversations/${workspace.conversation.id}/messages`, { data: { content: '不能绕过待确认' } })).status()).toBe(409);
    await rename(join(directory, 'workspace-pending.txt'), join(directory, 'workspace-pending.original'));
    await page.goto(`${workbench.url}/conversations/${other.id}`);
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    const active = await Promise.all(Array.from({ length: 10 }, async () => (await (await page.request.post(`${workbench.url}/api/conversations`)).json())));
    const extra = await (await page.request.post(`${workbench.url}/api/conversations`)).json();
    const previousRequests = upstream.requests.length;
    for (let index = 0; index < 10; index++) upstream.enqueue({ chunks: [`并发占用${index}`, '完成'], pauseAfter: 0 });
    const starts = await Promise.all(active.map((session, index) => page.request.post(`${workbench.url}/api/conversations/${session.id}/messages`, { data: { content: `占用名额${index}` } })));
    expect(starts.map((response) => response.status())).toEqual(Array(10).fill(202));
    await expect.poll(() => upstream.requests.length).toBe(previousRequests + 10);
    await page.goto(`${workbench.url}/conversations/${workspace.conversation.id}`);
    const retryRequest = page.waitForRequest((request) => request.url().endsWith('/retry') && request.method() === 'POST');
    await page.getByRole('button', { name: '确认重试', exact: true }).click();
    const retry = await retryRequest;
    await expect(page.getByRole('alert').last()).toContainText('最多同时运行 10 个会话');
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible();
    expect(upstream.requests).toHaveLength(previousRequests + 10);
    expect((await page.request.post(`${workbench.url}/api/conversations/${active[0].id}/stop`)).status()).toBe(200);
    upstream.enqueue({ chunks: ['原运行结束后确认仍能继续'] });
    expect((await page.request.post(retry.url(), { data: retry.postDataJSON() })).status()).toBe(202);
    const overflow = await page.request.post(`${workbench.url}/api/conversations/${extra.id}/messages`, { data: { content: '确认重试时不能挤入第十一个运行' } });
    expect(overflow.status()).toBe(409);
    await expect(page.getByTestId('assistant-message').last()).toHaveText('原运行结束后确认仍能继续', { timeout: 20_000 });
    expect(await readFile(join(directory, 'workspace-pending.txt'), 'utf8')).toBe(content);
    await expect(page.getByRole('status', { name: '待确认', exact: true })).toHaveCount(0);
    expect(upstream.requests).toHaveLength(previousRequests + 11);
  } finally { effect.close(); upstream.release(); }
});

test('确认重试自身再次中断会生成新的待确认代次，旧确认和停止后的迟到确认均不能执行', async ({ page, workbench, upstream }) => {
  test.setTimeout(90_000);
  await page.goto(workbench.url);
  await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await page.request.post(`${workbench.url}/api/local-tools/enable`);
  await page.reload();
  const first = crashAfterFileEffect(workbench, conversation.defaultDirectory, 'twice.txt');
  let second: ReturnType<typeof crashAfterFileEffect> | undefined;
  try {
    upstream.enqueue({ chunks: [{ toolCall: { id: 'twice-write', name: 'write', arguments: JSON.stringify({ path: 'twice.txt', content: 'z'.repeat(4 * 1024 * 1024) }) } }], delayMs: 0 });
    await page.getByRole('textbox', { name: '输入消息' }).fill('两次中断需要两次明确确认');
    await page.getByRole('button', { name: '发送消息' }).click();
    await first.crashed;
    first.close();
    await workbench.start();
    await page.reload();
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible({ timeout: 12_000 });
    await rename(join(conversation.defaultDirectory, 'twice.txt'), join(conversation.defaultDirectory, 'twice.original'));
    second = crashAfterFileEffect(workbench, conversation.defaultDirectory, 'twice.txt');
    const posted = page.waitForRequest((request) => request.url().endsWith('/retry') && request.method() === 'POST');
    await page.getByRole('button', { name: '确认重试', exact: true }).click();
    const originalConfirmation = await posted;
    expect(await second.crashed).toBeGreaterThan(0);
    const preserved = await readFile(join(conversation.defaultDirectory, 'twice.txt'));
    await workbench.start();
    await page.reload();
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible({ timeout: 12_000 });
    const late = await page.request.post(originalConfirmation.url(), { data: originalConfirmation.postDataJSON() });
    expect(late.status()).toBe(409);
    expect(await readFile(join(conversation.defaultDirectory, 'twice.txt'))).toEqual(preserved);
    expect(upstream.requests).toHaveLength(1);
    await page.getByRole('button', { name: '停止本轮', exact: true }).click();
    await expect(page.getByRole('button', { name: /write twice.txt 已停止/, includeHidden: true })).toHaveCount(1);
    expect((await page.request.post(originalConfirmation.url(), { data: { attempt: 1 } })).status()).toBe(409);
    expect(await readFile(join(conversation.defaultDirectory, 'twice.txt'))).toEqual(preserved);
    expect(upstream.requests).toHaveLength(1);
  } finally { first.close(); second?.close(); }
});

test('默认目录移走后拒绝旧写入确认和新文件工具，不重建旧目录且保留文件与历史', async ({ page, workbench, upstream }) => {
  test.setTimeout(90_000);
  await page.goto(workbench.url);
  await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await page.request.post(`${workbench.url}/api/local-tools/enable`);
  await page.reload();
  const effect = crashAfterFileEffect(workbench, conversation.defaultDirectory, 'moved.txt');
  const moved = `${conversation.defaultDirectory}-moved`;
  try {
    upstream.enqueue({ chunks: [{ toolCall: { id: 'moved-write', name: 'write', arguments: JSON.stringify({ path: 'moved.txt', content: 'm'.repeat(4 * 1024 * 1024) }) } }], delayMs: 0 });
    await page.getByRole('textbox', { name: '输入消息' }).fill('移动目录前的写入');
    await page.getByRole('button', { name: '发送消息' }).click();
    await effect.crashed;
    const original = await readFile(join(conversation.defaultDirectory, 'moved.txt'));
    await rename(conversation.defaultDirectory, moved);
    await workbench.start();
    await page.reload();
    await expect(page.getByText('工作目录不可用', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认重试', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('目录不可用');
    await expect(stat(conversation.defaultDirectory)).rejects.toThrow();
    expect(upstream.requests).toHaveLength(1);
    await page.getByRole('button', { name: '停止本轮', exact: true }).click();
    await expect(page.getByRole('button', { name: /write moved.txt 已停止/, includeHidden: true })).toHaveCount(1);
    await page.getByRole('textbox', { name: '输入消息' }).fill('失效目录不能创建文件');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByRole('alert')).toContainText('工作目录不可用');
    await expect(page.getByRole('button', { name: /write unexpected.txt/, includeHidden: true })).toHaveCount(0);
    await expect(stat(conversation.defaultDirectory)).rejects.toThrow();
    expect(await readFile(join(moved, 'moved.txt'))).toEqual(original);
    expect(upstream.requests).toHaveLength(1);
  } finally { effect.close(); }
});

test('同一工作区两个会话竞争创建同名真实文件时至多一个成功，另一个收到真实冲突', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const directory = join(workbench.dataDir, 'write-race');
  await mkdir(directory);
  const first = (await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json()).conversation;
  const second = await (await page.request.post(`${workbench.url}/api/conversations`, { data: { workspaceId: first.workspaceId } })).json();
  for (const [index, content] of ['竞争者甲的完整内容', '竞争者乙的完整内容'].entries()) upstream.enqueue({ chunks: [{ toolCall: { id: `race-${index}`, name: 'write', arguments: JSON.stringify({ path: 'race.txt', content }) } }], pauseAfter: 0 });
  upstream.enqueue({ chunks: ['第一位完成'] });
  upstream.enqueue({ chunks: ['第二位完成'] });
  const starts = await Promise.all([first, second].map((session) => page.request.post(`${workbench.url}/api/conversations/${session.id}/messages`, { data: { content: '创建竞争文件' } })));
  expect(starts.map((response) => response.status())).toEqual([202, 202]);
  await expect.poll(() => upstream.requests.length).toBe(2);
  upstream.release();
  await expect.poll(() => upstream.finishedResponses).toBe(4);
  const results = upstream.requests.slice(2).map((request) => JSON.stringify(request.messages.find((message) => message.role === 'tool')));
  expect(results.filter((result) => result.includes('Successfully wrote to race.txt'))).toHaveLength(1);
  expect(results.filter((result) => /EEXIST|目标(?:文件|路径)已存在/.test(result)), results.join('\n')).toHaveLength(1);
  expect(['竞争者甲的完整内容', '竞争者乙的完整内容']).toContain(await readFile(join(directory, 'race.txt'), 'utf8'));
});
