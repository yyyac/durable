import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, Workbench, type Upstream } from './fixtures';
import type { ConversationSummary } from '../src/types';
import { openLegacyRunningWorkbench } from './legacy-workbench';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';

async function configureCapacityModels(request: APIRequestContext, url: string, upstream: Upstream) {
  const response = await request.put(`${url}/api/settings`, { data: {
    services: [{ id: 'capacity-service', name: '并发测试服务', baseUrl: upstream.url, apiKey: 'capacity-test-key', protocol: 'openai-completions', models: [
      { id: 'a', modelId: 'model-a', name: '模型甲' }, { id: 'b', modelId: 'model-b', name: '模型乙' },
    ] }], selectedModel: { serviceId: 'capacity-service', modelId: 'a' },
  } });
  expect(response.ok()).toBe(true);
}

async function createSession(request: APIRequestContext, url: string, workspaceId?: string): Promise<ConversationSummary> {
  const response = await request.post(`${url}/api/conversations`, { data: { workspaceId } });
  expect(response.status()).toBe(201);
  return response.json();
}

function pauseReplies(upstream: Upstream, count: number) {
  for (let index = 0; index < count; index++) upstream.enqueue({ chunks: ['运行中的输出', '，完成。'], pauseAfter: 0 });
}

test('普通会话和多个工作区共享十个名额，满额保留草稿且不会隐藏排队', async ({ page, workbench, upstream }) => {
  await configureCapacityModels(page.request, workbench.url, upstream);
  const sessions: ConversationSummary[] = [];
  for (const name of ['项目甲', '项目乙']) {
    const path = join(workbench.dataDir, name);
    await mkdir(path);
    const response = await page.request.post(`${workbench.url}/api/workspaces`, { data: { path, trusted: true } });
    expect(response.status()).toBe(201);
    const first: ConversationSummary = (await response.json()).conversation;
    sessions.push(first, await createSession(page.request, workbench.url, first.workspaceId));
  }
  while (sessions.length < 10) sessions.push(await createSession(page.request, workbench.url));
  const extra = await createSession(page.request, workbench.url);
  pauseReplies(upstream, 10);
  const responses = await Promise.all(sessions.map((session, index) => page.request.post(`${workbench.url}/api/conversations/${session.id}/messages`, { data: { content: `并行问题${index}` } })));
  expect(responses.map((response) => response.status())).toEqual(Array(10).fill(202));
  await expect.poll(() => upstream.requests.length).toBe(10);
  await page.goto(`${workbench.url}/conversations/${extra.id}`);
  await page.getByRole('textbox', { name: '输入消息' }).fill('第十一个问题');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('最多同时运行 10 个会话');
  await expect(page.getByRole('textbox', { name: '输入消息' })).toHaveValue('第十一个问题');
  await expect(page.getByTestId('user-message')).toHaveCount(0);
  const rejected = await page.request.post(`${workbench.url}/api/conversations/${extra.id}/messages`, { data: { content: '接口也不能绕过', modelSelection: { serviceId: 'capacity-service', modelId: 'b' } } });
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).error).toContain('最多同时运行 10 个会话');
  const overlap = await page.request.post(`${workbench.url}/api/conversations/${sessions[0].id}/messages`, { data: { content: '同会话重叠', modelSelection: { serviceId: 'capacity-service', modelId: 'b' } } });
  expect(overlap.status()).toBe(409);
  expect((await overlap.json()).error).toContain('当前会话正在生成');
  expect(upstream.requests.every((request) => request.model === 'model-a')).toBe(true);
  upstream.release();
  await page.goto(`${workbench.url}/conversations/${sessions[0].id}`);
  await expect(page.getByTestId('assistant-message')).toHaveText('运行中的输出，完成。');
  await page.goto(`${workbench.url}/conversations/${extra.id}`);
  await expect(page.getByTestId('user-message')).toHaveCount(0);
  expect(upstream.requests).toHaveLength(10);
  upstream.enqueue({ chunks: ['明确再次发送后完成'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('明确再次发送');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('明确再次发送后完成');
  expect(upstream.requests[10].model).toBe('model-a');
  expect(upstream.requests[10].messages).toEqual([{ role: 'user', content: '明确再次发送' }]);
});

test('旧库超过十个运行时恢复明确停止超额会话并保留已生成输出', async ({ page, workbench, upstream }) => {
  test.setTimeout(60_000);
  await configureCapacityModels(page.request, workbench.url, upstream);
  await workbench.stop();
  const directory = join(workbench.dataDir, 'legacy-capacity');
  await mkdir(directory);
  await copyFile(join(workbench.dataDir, 'models.json'), join(directory, 'models.json'));
  pauseReplies(upstream, 11);
  const legacy = await openLegacyRunningWorkbench(directory, upstream.url, 11);
  try {
    await expect.poll(() => upstream.requests.length).toBe(11);
    await page.waitForTimeout(1_100);
  } finally { await legacy.close(BACKGROUND_CONTEXT); }
  pauseReplies(upstream, 10);
  const migrated = new Workbench(directory, workbench.port);
  await migrated.start();
  try {
    await page.goto(workbench.url);
    const sessions: ConversationSummary[] = await (await page.request.get(`${workbench.url}/api/conversations`)).json();
    const overflow = sessions.find((session) => session.title === '旧版运行10')!;
    await page.goto(`${workbench.url}/conversations/${overflow.id}`);
    await expect(page.getByRole('alert')).toContainText('恢复时超过同时运行上限');
    await expect(page.getByRole('button', { name: '重试回复', exact: true })).toBeVisible();
    await expect(page.getByTestId('assistant-message')).toContainText('运行中的输出');
    await expect.poll(() => upstream.requests.length, { timeout: 12_000 }).toBe(21);
    const retry = await page.request.post(`${workbench.url}/api/conversations/${overflow.id}/retry`);
    expect(retry.status()).toBe(409);
    expect((await retry.json()).error).toContain('最多同时运行 10 个会话');
    upstream.release();
    const active = sessions.find((session) => session.title === '旧版运行0')!;
    await page.goto(`${workbench.url}/conversations/${active.id}`);
    await expect(page.getByTestId('assistant-message').last()).toHaveText('运行中的输出，完成。');
    await page.goto(`${workbench.url}/conversations/${overflow.id}`);
    expect(upstream.requests).toHaveLength(21);
    await expect(page.getByRole('alert')).toContainText('恢复时超过同时运行上限');
    upstream.enqueue({ chunks: ['手动恢复超额会话'] });
    await page.getByRole('button', { name: '重试回复', exact: true }).click();
    await expect(page.getByTestId('assistant-message').last()).toHaveText('手动恢复超额会话');
    expect(upstream.requests).toHaveLength(22);
  } finally { await migrated.stop(); await workbench.start(); }
});

test('最后一个名额的并发竞争只有一方成功，被拒绝的请求不改变获准模型', async ({ page, workbench, upstream }) => {
  await configureCapacityModels(page.request, workbench.url, upstream);
  const sessions = await Promise.all(Array.from({ length: 11 }, () => createSession(page.request, workbench.url)));
  pauseReplies(upstream, 10);
  for (const session of sessions.slice(0, 9)) expect((await page.request.post(`${workbench.url}/api/conversations/${session.id}/messages`, { data: { content: '占用名额' } })).status()).toBe(202);
  await expect.poll(() => upstream.requests.length).toBe(9);
  const contenders = sessions.slice(9);
  const responses = await Promise.all(contenders.map((session, index) => page.request.post(`${workbench.url}/api/conversations/${session.id}/messages`, { data: {
    content: `竞争问题${index}`, modelSelection: { serviceId: 'capacity-service', modelId: index ? 'b' : 'a' },
  } })));
  const statuses = responses.map((response) => response.status());
  expect(statuses.toSorted()).toEqual([202, 409]);
  await expect.poll(() => upstream.requests.length).toBe(10);
  const admittedIndex = statuses.indexOf(202);
  expect(upstream.requests[9].model).toBe(admittedIndex ? 'model-b' : 'model-a');
  await page.goto(`${workbench.url}/conversations/${contenders[1 - admittedIndex].id}`);
  await expect(page.getByTestId('user-message')).toHaveCount(0);
  upstream.release();
  await page.goto(`${workbench.url}/conversations/${contenders[admittedIndex].id}`);
  await expect(page.getByTestId('assistant-message')).toHaveText('运行中的输出，完成。');
  await expect(page.getByTestId('user-message')).toHaveText(`竞争问题${admittedIndex}`);
  expect(upstream.requests).toHaveLength(10);
});

test('满额拒绝回复重试，显式停止和失败后释放名额供手动请求使用', async ({ page, workbench, upstream }) => {
  await configureCapacityModels(page.request, workbench.url, upstream);
  const failed = await createSession(page.request, workbench.url);
  upstream.enqueue({ chunks: [], failure: { status: 401, message: '原来的失败原因' } });
  expect((await page.request.post(`${workbench.url}/api/conversations/${failed.id}/messages`, { data: { content: '原来的问题' } })).status()).toBe(202);
  await page.goto(`${workbench.url}/conversations/${failed.id}`);
  await expect(page.getByRole('button', { name: '重试回复', exact: true })).toBeVisible();
  const sessions = await Promise.all(Array.from({ length: 10 }, () => createSession(page.request, workbench.url)));
  pauseReplies(upstream, 10);
  for (const session of sessions) expect((await page.request.post(`${workbench.url}/api/conversations/${session.id}/messages`, { data: { content: '持续运行' } })).status()).toBe(202);
  await expect.poll(() => upstream.requests.length).toBe(11);
  await page.getByRole('button', { name: '重试回复', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('最多同时运行 10 个会话');
  await expect(page.getByRole('alert').first()).toContainText('原来的失败原因');
  expect(upstream.requests).toHaveLength(11);
  expect((await page.request.post(`${workbench.url}/api/conversations/${sessions[0].id}/stop`)).ok()).toBe(true);
  await page.goto(`${workbench.url}/conversations/${sessions[0].id}`);
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-message')).toContainText('运行中的输出');
  upstream.enqueue({ chunks: [], failure: { status: 401, message: '重试后的失败原因' } });
  expect((await page.request.post(`${workbench.url}/api/conversations/${failed.id}/retry`)).status()).toBe(202);
  await page.goto(`${workbench.url}/conversations/${failed.id}`);
  await expect(page.getByRole('alert')).toContainText('重试后的失败原因');
  expect(upstream.requests[11].model).toBe('model-a');
  expect(upstream.requests[11].messages).toEqual([{ role: 'user', content: '原来的问题' }]);
  await expect(page.getByTestId('user-message')).toHaveCount(1);
  const extra = await createSession(page.request, workbench.url);
  upstream.enqueue({ chunks: ['失败释放的名额可重新使用'] });
  expect((await page.request.post(`${workbench.url}/api/conversations/${extra.id}/messages`, { data: { content: '明确的新问题' } })).status()).toBe(202);
  await page.goto(`${workbench.url}/conversations/${extra.id}`);
  await expect(page.getByTestId('assistant-message')).toHaveText('失败释放的名额可重新使用');
  upstream.release();
});

test('关闭网页不释放后台名额，真实崩溃恢复仍拒绝第十一个运行且完成任务不重跑', async ({ page, context, workbench, upstream }) => {
  test.setTimeout(60_000);
  await configureCapacityModels(page.request, workbench.url, upstream);
  const sessions = await Promise.all(Array.from({ length: 11 }, () => createSession(page.request, workbench.url)));
  pauseReplies(upstream, 10);
  for (const session of sessions.slice(0, 10)) expect((await page.request.post(`${workbench.url}/api/conversations/${session.id}/messages`, { data: { content: '需要恢复的问题' } })).status()).toBe(202);
  await expect.poll(() => upstream.requests.length).toBe(10);
  await page.goto(`${workbench.url}/conversations/${sessions[0].id}`);
  await expect(page.getByTestId('assistant-message')).toHaveText('运行中的输出');
  await page.waitForTimeout(1_100);
  await page.close();
  const observer = await context.newPage();
  await observer.goto(`${workbench.url}/conversations/${sessions[10].id}`);
  const full = await observer.request.post(`${workbench.url}/api/conversations/${sessions[10].id}/messages`, { data: { content: '关闭页面后仍应拒绝' } });
  expect(full.status()).toBe(409);
  await workbench.crash();
  pauseReplies(upstream, 10);
  await workbench.start();
  await expect.poll(() => upstream.requests.length, { timeout: 12_000 }).toBe(20);
  const recoveredFull = await observer.request.post(`${workbench.url}/api/conversations/${sessions[10].id}/messages`, { data: { content: '恢复期间仍应拒绝' } });
  expect(recoveredFull.status()).toBe(409);
  upstream.release();
  await observer.goto(`${workbench.url}/conversations/${sessions[0].id}`);
  await expect(observer.getByTestId('assistant-message').last()).toHaveText('运行中的输出，完成。');
  for (const session of sessions.slice(0, 10)) {
    await observer.goto(`${workbench.url}/conversations/${session.id}`);
    await expect(observer.getByRole('button', { name: '发送消息', exact: true })).toBeVisible();
  }
  await workbench.crash();
  await workbench.start();
  await observer.reload();
  await expect(observer.getByTestId('assistant-message').last()).toHaveText('运行中的输出，完成。');
  expect(upstream.requests).toHaveLength(20);
  upstream.enqueue({ chunks: ['恢复后的空位可用'] });
  expect((await observer.request.post(`${workbench.url}/api/conversations/${sessions[10].id}/messages`, { data: { content: '恢复完成后明确发送' } })).status()).toBe(202);
  await observer.goto(`${workbench.url}/conversations/${sessions[10].id}`);
  await expect(observer.getByTestId('assistant-message')).toHaveText('恢复后的空位可用');
  expect(upstream.requests).toHaveLength(21);
});
