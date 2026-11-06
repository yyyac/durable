import { mkdir, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { configureModel } from './configure-model';
import { crashAfterFileEffect } from './write-effect';
import { DEFAULT_RESTART_LIMIT, DEFAULT_RETRY_POLICY } from '@earendil-works/pi-durable';

test('归档工作区隐藏侧栏但保留搜索历史，当前及其他页面同步只读且后端拒绝新任务', async ({ page, context, workbench, upstream }, testInfo) => {
  const directory = join(workbench.dataDir, `归档项目${'长目录'.repeat(25)}`);
  await mkdir(directory);
  await writeFile(join(directory, 'note.txt'), '归档前的真实文件');
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const created = await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json();
  const session = created.conversation;
  await page.request.patch(`${workbench.url}/api/workspaces/${session.workspaceId}`, { data: { name: '归档项目' } });
  await page.goto(`${workbench.url}/conversations/${session.id}`);
  upstream.enqueue({ chunks: [{ toolCall: { id: 'archive-read', name: 'read', arguments: '{"path":"note.txt"}' } }] });
  upstream.enqueue({ chunks: ['可回看的文件读取历史'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('归档前的问题');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('可回看的文件读取历史');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  const observer = await context.newPage();
  await observer.goto(page.url());
  await expect(observer.getByTestId('assistant-message').last()).toHaveText('可回看的文件读取历史');
  await page.getByRole('button', { name: '归档项目的工作区菜单', exact: true }).click();
  const archived = page.waitForResponse((response) => response.url().endsWith(`/api/workspaces/${session.workspaceId}`) && response.request().method() === 'PATCH');
  await page.getByRole('menuitem', { name: '归档工作区', exact: true }).click();
  expect((await archived).ok()).toBe(true);
  for (const view of [page, observer]) {
    await expect(view.getByRole('region', { name: '归档项目工作区', exact: true })).toHaveCount(0);
    await expect(view.getByText('工作区已归档，仅可查看历史。', { exact: true })).toBeVisible();
    await expect(view.getByRole('textbox', { name: '输入消息' })).toBeDisabled();
    await expect(view.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  }
  for (const [path, data] of [
    ['/api/conversations', { workspaceId: session.workspaceId }],
    [`/api/conversations/${session.id}/messages`, { content: '不能继续发送' }],
    [`/api/conversations/${session.id}/retry`, {}],
  ] as const) {
    const response = await page.request.post(`${workbench.url}${path}`, { data });
    expect(response.ok()).toBe(false);
    expect((await response.json()).error).toContain('工作区已归档');
  }
  for (const [path, data] of [
    [`/api/workspaces/${session.workspaceId}`, { name: '归档期间不能重命名' }],
    [`/api/conversations/${session.id}`, { title: '归档期间不能修改会话' }],
    [`/api/conversations/${session.id}`, { archived: true }],
  ] as const) {
    const response = await page.request.patch(`${workbench.url}${path}`, { data });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('工作区已归档');
  }
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索会话', exact: true }).fill('归档前的问题');
  const result = page.getByRole('dialog', { name: '搜索会话' }).getByRole('button').filter({ hasText: '归档前的问题' });
  await expect(result).toContainText('工作区已归档');
  await expect(result.getByText('工作区已归档', { exact: true })).toBeVisible();
  await expect(result).toContainText(directory);
  await page.screenshot({ path: testInfo.outputPath('workspace-archive-search.png') });
  await result.click();
  await page.getByRole('button', { name: /read note.txt 已完成/ }).click();
  await expect(page.getByTestId('tool-output')).toContainText('归档前的真实文件');
  await workbench.stop();
  await workbench.start();
  await page.reload();
  await expect(page.getByText('工作区已归档，仅可查看历史。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('可回看的文件读取历史');
  await page.screenshot({ path: testInfo.outputPath('workspace-archive-history.png') });
  expect(await readFile(join(directory, 'note.txt'), 'utf8')).toBe('归档前的真实文件');
  const persisted = await (await page.request.get(`${workbench.url}/api/conversations?includeArchived=true`)).json();
  expect(persisted.find((item: { id: string }) => item.id === session.id)).toMatchObject({ id: session.id, workspaceId: session.workspaceId });
  await page.getByRole('button', { name: '恢复工作区', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '输入消息' })).toBeEnabled();
  await expect(observer.getByRole('textbox', { name: '输入消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(2);
});

test('运行中及原运行结束后的待确认任务均阻止归档，停止后归档拒绝迟到确认且保留文件', async ({ page, workbench, upstream }) => {
  test.setTimeout(120_000);
  const directory = join(workbench.dataDir, '有任务的项目');
  await mkdir(directory);
  await page.goto(workbench.url);
  await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
  const { conversation } = await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json();
  await page.goto(`${workbench.url}/conversations/${conversation.id}`);
  upstream.enqueue({ chunks: ['仍在运行的输出', '完成'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('运行期间不能归档');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('仍在运行的输出');
  await page.getByRole('button', { name: '有任务的项目的工作区菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '归档工作区', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请先停止或等待完成后归档');
  expect((await page.request.post(`${workbench.url}/api/conversations/${conversation.id}/stop`)).ok()).toBe(true);
  upstream.release();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  const effect = crashAfterFileEffect(workbench, directory, 'pending.txt');
  try {
    upstream.enqueue({ chunks: [{ toolCall: { id: 'archive-pending', name: 'write', arguments: JSON.stringify({ path: 'pending.txt', content: 'x'.repeat(4 * 1024 * 1024) }) } }], delayMs: 0 });
    await page.getByRole('textbox', { name: '输入消息' }).fill('待确认任务不能被归档隐藏');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    expect(await effect.crashed).toBeGreaterThan(0);
    await workbench.start(); await page.reload();
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible({ timeout: 12_000 });
    const original = await readFile(join(directory, 'pending.txt'));
    const posted = page.waitForRequest((request) => request.method() === 'POST' && /\/tools\/\d+\/retry$/.test(request.url()));
    await page.getByRole('button', { name: '确认重试', exact: true }).click();
    const oldConfirmation = await posted;
    await expect(page.getByRole('alert').last()).toContainText('已存在');
    for (let round = 0; round <= DEFAULT_RESTART_LIMIT; round++) {
      await workbench.crash(); await workbench.start(); await page.reload();
      await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible();
      if (round < DEFAULT_RETRY_POLICY.maxRetries) await page.waitForTimeout(DEFAULT_RETRY_POLICY.baseDelayMs * 2 ** round + 1000);
    }
    const state = await page.evaluate((id) => new Promise<{ failure?: unknown }>((resolve) => {
      const source = new EventSource(`/api/conversations/${id}/events`);
      source.addEventListener('state', (event) => { source.close(); resolve(JSON.parse(event.data)); });
    }), conversation.id);
    expect(state.failure).toBeTruthy();
    const blocked = await page.request.patch(`${workbench.url}/api/workspaces/${conversation.workspaceId}`, { data: { archived: true } });
    expect(blocked.status()).toBe(400);
    expect((await blocked.json()).error).toContain('待确认任务');
    await page.getByRole('button', { name: '停止本轮', exact: true }).click();
    await expect(page.getByRole('button', { name: /write pending.txt 已停止/ })).toBeVisible();
    expect((await page.request.patch(`${workbench.url}/api/workspaces/${conversation.workspaceId}`, { data: { archived: true } })).ok()).toBe(true);
    await expect(page.getByText('工作区已归档，仅可查看历史。', { exact: true })).toBeVisible();
    const late = await page.request.post(oldConfirmation.url(), { data: oldConfirmation.postDataJSON() });
    expect(late.status()).toBe(409);
    expect((await late.json()).error).toContain('工作区已归档');
    expect(await readFile(join(directory, 'pending.txt'))).toEqual(original);
    expect(upstream.requests).toHaveLength(2);
  } finally { effect.close(); }
});

test('归档与运行提交竞争时仅允许合法一方，不留下隐藏执行', async ({ page, workbench, upstream }) => {
  const directory = join(workbench.dataDir, '竞争项目');
  await mkdir(directory);
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const { conversation } = await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json();
  upstream.enqueue({ chunks: ['竞争获准后的输出'], pauseAfter: 0 });
  const [archiving, sending] = await Promise.all([
    page.request.patch(`${workbench.url}/api/workspaces/${conversation.workspaceId}`, { data: { archived: true } }),
    page.request.post(`${workbench.url}/api/conversations/${conversation.id}/messages`, { data: { content: '同事务竞争的问题' } }),
  ]);
  if (archiving.ok()) {
    expect(sending.status()).toBe(400);
    expect((await sending.json()).error).toContain('工作区已归档');
    expect(upstream.requests).toHaveLength(0);
  } else {
    expect(sending.status()).toBe(202);
    expect((await archiving.json()).error).toContain('运行中或待确认任务');
    await expect.poll(() => upstream.requests.length).toBe(1);
    expect((await page.request.post(`${workbench.url}/api/conversations/${conversation.id}/stop`)).ok()).toBe(true);
    expect((await page.request.patch(`${workbench.url}/api/workspaces/${conversation.workspaceId}`, { data: { archived: true } })).ok()).toBe(true);
  }
  upstream.release();
  await page.goto(`${workbench.url}/conversations/${conversation.id}`);
  await expect(page.getByText('工作区已归档，仅可查看历史。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
});

test('没有可见会话的归档工作区仍有独立恢复入口，目录丢失恢复后保留历史且不可执行', async ({ page, workbench, upstream }) => {
  const directory = join(workbench.dataDir, '空工作区');
  await mkdir(directory);
  await writeFile(join(directory, 'retained.txt'), '归档不删除文件');
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const { conversation } = await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json();
  await page.request.patch(`${workbench.url}/api/conversations/${conversation.id}`, { data: { archived: true } });
  await page.request.patch(`${workbench.url}/api/workspaces/${conversation.workspaceId}`, { data: { archived: true } });
  await rename(directory, `${directory}-moved`);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '选择工作目录', exact: true }).click();
  const restore = page.getByRole('menuitem', { name: '恢复空工作区工作区', exact: true });
  await expect(restore).toHaveAttribute('title', directory);
  await restore.click();
  await expect(page.getByRole('alert')).toContainText('工作目录不可用');
  await expect(page.getByRole('region', { name: '空工作区工作区', exact: true })).toBeVisible();
  const workspace = (await (await page.request.get(`${workbench.url}/api/workspaces`)).json())[0];
  expect(workspace).toMatchObject({ id: conversation.workspaceId, directory, archived: false });
  await page.goto(`${workbench.url}/conversations/${conversation.id}`);
  await expect(page.getByText('工作目录不可用', { exact: true })).toBeVisible();
  for (const [path, data] of [
    ['/api/conversations', { workspaceId: conversation.workspaceId }],
    [`/api/conversations/${conversation.id}/messages`, { content: '不能在旧目录继续' }],
  ] as const) {
    const response = await page.request.post(`${workbench.url}${path}`, { data });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('工作目录不可用');
  }
  await workbench.stop(); await workbench.start(); await page.reload();
  await expect(page.getByText('工作目录不可用', { exact: true })).toBeVisible();
  await expect(stat(directory)).rejects.toThrow();
  expect(await readFile(join(`${directory}-moved`, 'retained.txt'), 'utf8')).toBe('归档不删除文件');
  expect(upstream.requests).toHaveLength(0);
});

test('重新添加归档目录提示恢复原身份，恢复后可执行且保留会话各自的归档状态', async ({ page, workbench, upstream }) => {
  const directory = join(workbench.dataDir, '恢复原项目');
  const alias = join(workbench.dataDir, '项目别名');
  await mkdir(directory);
  await symlink(directory, alias, 'junction');
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const { conversation: first } = await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json();
  const second = await (await page.request.post(`${workbench.url}/api/conversations`, { data: { workspaceId: first.workspaceId } })).json();
  await page.request.patch(`${workbench.url}/api/conversations/${first.id}`, { data: { title: '仍然可见的旧会话' } });
  await page.request.patch(`${workbench.url}/api/conversations/${second.id}`, { data: { title: '单独归档的旧会话' } });
  await page.request.patch(`${workbench.url}/api/conversations/${second.id}`, { data: { archived: true } });
  expect((await page.request.patch(`${workbench.url}/api/workspaces/${first.workspaceId}`, { data: { archived: true } })).ok()).toBe(true);
  const before = await (await page.request.get(`${workbench.url}/api/conversations?includeArchived=true`)).json();
  for (const path of [directory, alias, ...(process.platform === 'win32' ? [directory.toUpperCase()] : [])]) {
    const response = await page.request.post(`${workbench.url}/api/workspaces`, { data: { path, trusted: true } });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ workspaceId: first.workspaceId, error: expect.stringContaining('工作区已归档') });
  }
  await page.goto(workbench.url);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '选择工作目录', exact: true }).click();
  await page.getByRole('menuitem', { name: '填写文件夹路径…' }).click();
  const dialog = page.getByRole('dialog', { name: '添加工作区' });
  await dialog.getByRole('textbox', { name: '文件夹绝对路径' }).fill(directory);
  await dialog.getByRole('checkbox', { name: '我已了解并信任此工作区的本机工具访问' }).check();
  await dialog.getByRole('button', { name: '添加并开始会话' }).click();
  await expect(dialog.getByRole('alert')).toContainText('工作区已归档');
  await dialog.getByRole('button', { name: '恢复原工作区', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const group = page.getByRole('region', { name: '恢复原项目工作区', exact: true });
  await expect(group.getByRole('button', { name: '仍然可见的旧会话', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: '单独归档的旧会话', exact: true })).toHaveCount(0);
  const after = await (await page.request.get(`${workbench.url}/api/conversations?includeArchived=true`)).json();
  for (const session of before) expect(after.find((item: { id: string }) => item.id === session.id)).toEqual(session);
  expect(after).toHaveLength(before.length + 1);
  const workspaces = await (await page.request.get(`${workbench.url}/api/workspaces`)).json();
  expect(workspaces).toHaveLength(1);
  expect(workspaces[0]).toMatchObject({ id: first.workspaceId, directory, archived: false });
  await group.getByRole('button', { name: '仍然可见的旧会话', exact: true }).click();
  upstream.enqueue({ chunks: [{ toolCall: { id: 'restored-write', name: 'write', arguments: '{"path":"after-restore.txt","content":"恢复后新文件"}' } }] });
  upstream.enqueue({ chunks: ['恢复后可以继续工作'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('恢复后明确创建文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('恢复后可以继续工作');
  expect(await readFile(join(directory, 'after-restore.txt'), 'utf8')).toBe('恢复后新文件');
  expect(upstream.requests).toHaveLength(2);
});
