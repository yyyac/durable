import { revealTool } from './tool-details';
import { mkdir, rename, readFile, writeFile, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { configureModel } from './configure-model';
import { crashAfterFileEffect } from './write-effect';

async function enableTools(page: Page) {
  await page.getByRole('button', { name: '启用本机工具', exact: true }).click();
  await page.getByRole('dialog', { name: '启用本机工具' }).getByRole('button', { name: '确认启用', exact: true }).click();
}
async function previewRelocation(page: Page, path: string) {
  await page.getByRole('button', { name: '重新定位工作目录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重新定位工作目录' });
  await dialog.getByRole('textbox', { name: '新目录绝对路径' }).fill(path);
  await dialog.getByRole('button', { name: '检查目录', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '确认重新定位', exact: true })).toBeVisible();
  return dialog;
}

test('普通默认目录显式重新定位保留会话历史与草稿，真实读取写入和命令改用新目录', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  await enableTools(page);
  const session = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  const originalUrl = page.url();
  const originalPath = join(session.defaultDirectory, 'original.txt');
  await writeFile(originalPath, '移动前真实内容');
  upstream.enqueue({ chunks: [{ toolCall: { id: 'original-read', name: 'read', arguments: JSON.stringify({ path: originalPath }) } }] });
  upstream.enqueue({ chunks: ['保留原目录工具历史'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('读取原目录文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('保留原目录工具历史');
  const target = join(workbench.dataDir, '移动后的普通目录');
  await rename(session.defaultDirectory, target);
  await page.reload();
  await expect(page.getByText('工作目录不可用', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '输入消息' }).fill('修复过程中保留的草稿');
  await expect(page.getByRole('button', { name: '重新定位工作目录', exact: true })).toBeVisible();
  const dialog = await previewRelocation(page, target);
  await expect(dialog).toContainText(session.defaultDirectory);
  await expect(dialog).toContainText(target);
  await page.screenshot({ path: 'E:/Agent/durable/.tmp-reference-inspection/spec11/qa21-confirm-paths.png' });
  await dialog.getByRole('button', { name: '确认重新定位', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(page.url()).toBe(originalUrl);
  await expect(page.getByRole('textbox', { name: '输入消息' })).toHaveValue('修复过程中保留的草稿');
  await expect(page.getByRole('button', { name: '打开工作目录', exact: true })).toHaveAttribute('title', target);
  await expect(page.getByText('工作目录不可用', { exact: true })).toHaveCount(0);
  await (await revealTool(page, /read .*original.txt 已完成/)).click();
  expect(JSON.parse(await page.getByLabel('工具参数').first().innerText())).toEqual({ path: originalPath });
  upstream.enqueue({ chunks: [{ toolCall: { id: 'relocated-read', name: 'read', arguments: '{"path":"original.txt"}' } }] });
  upstream.enqueue({ chunks: [{ toolCall: { id: 'relocated-write', name: 'write', arguments: '{"path":"created.txt","content":"新目录创建内容"}' } }] });
  upstream.enqueue({ chunks: [{ toolCall: { id: 'relocated-command', name: 'powershell', arguments: JSON.stringify({ command: '[Console]::Write((Get-Location).Path)' }) } }] });
  upstream.enqueue({ chunks: ['在新目录完成'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('在新目录读写并检查命令位置');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('在新目录完成', { timeout: 15_000 });
  expect(await readFile(join(target, 'created.txt'), 'utf8')).toBe('新目录创建内容');
  expect(JSON.stringify(upstream.requests.at(-1)?.messages)).toContain(target.replaceAll('\\', '\\\\'));
  const relocated = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  expect(relocated).toMatchObject({ id: session.id, defaultDirectory: target });
  expect(relocated.workspaceId).toBeUndefined();
  await workbench.stop(); await workbench.start(); await page.reload();
  await expect(page.getByRole('button', { name: '打开工作目录', exact: true })).toHaveAttribute('title', target);
  await expect(page.getByTestId('assistant-message').last()).toHaveText('在新目录完成');
  await page.screenshot({ path: 'E:/Agent/durable/.tmp-reference-inspection/spec11/qa21-relocated.png' });
  await expect(stat(session.defaultDirectory)).rejects.toThrow();
  expect(upstream.requests).toHaveLength(6);
});

test('工作区重新定位校验无效和实际目录占用，取消不改关联且全部会话保持身份', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const directory = join(workbench.dataDir, '原工作区');
  const occupied = join(workbench.dataDir, '已有工作区');
  const target = join(workbench.dataDir, '移动后工作区');
  await mkdir(directory); await mkdir(occupied);
  await writeFile(join(directory, 'shared.txt'), '重新定位后共享内容');
  const first = (await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json()).conversation;
  const second = await (await page.request.post(`${workbench.url}/api/conversations`, { data: { workspaceId: first.workspaceId } })).json();
  await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: occupied, trusted: true } });
  await rename(directory, target);
  const before = await (await page.request.get(`${workbench.url}/api/workspaces`)).json();
  const previewUrl = `${workbench.url}/api/conversations/${first.id}/directory/preview`;
  for (const path of ['relative', join(target, 'missing'), join(target, 'shared.txt'), occupied]) {
    const response = await page.request.post(previewUrl, { data: { path } });
    expect(response.status()).toBe(400);
  }
  if (process.platform === 'win32') {
    const movedOccupied = join(workbench.dataDir, '已有工作区实际新位置');
    await rename(occupied, movedOccupied);
    await symlink(movedOccupied, occupied, 'junction');
    const alias = join(workbench.dataDir, 'occupied-alias');
    await symlink(occupied, alias, 'junction');
    for (const path of [movedOccupied, alias]) {
      const response = await page.request.post(previewUrl, { data: { path } });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toContain('该目录已被其他工作区使用');
    }
  }
  await page.goto(`${workbench.url}/conversations/${first.id}`);
  const dialog = await previewRelocation(page, target);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await (await page.request.get(`${workbench.url}/api/workspaces`)).json()).toEqual(before);
  const confirmed = await previewRelocation(page, target);
  await confirmed.getByRole('button', { name: '确认重新定位', exact: true }).click();
  await expect(confirmed).not.toBeVisible();
  await expect(page.getByRole('button', { name: '打开工作目录', exact: true })).toHaveAttribute('title', target);
  const after = await (await page.request.get(`${workbench.url}/api/workspaces`)).json();
  expect(after.find((item: { id: string }) => item.id === first.workspaceId)).toMatchObject({ id: first.workspaceId, name: '原工作区', directory: target, directoryVersion: 1 });
  await page.goto(`${workbench.url}/conversations/${second.id}`);
  await expect(page.getByRole('button', { name: '打开工作目录', exact: true })).toHaveAttribute('title', target);
  upstream.enqueue({ chunks: [{ toolCall: { id: 'shared-after-move', name: 'read', arguments: '{"path":"shared.txt"}' } }] });
  upstream.enqueue({ chunks: ['另一个会话读取新位置'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('读取共享文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('另一个会话读取新位置');
  expect(JSON.stringify(upstream.requests[1].messages)).toContain('重新定位后共享内容');
  const sessions = await (await page.request.get(`${workbench.url}/api/conversations`)).json();
  for (const item of sessions.filter((item: { workspaceId?: string }) => item.workspaceId === first.workspaceId)) {
    expect([first.id, second.id]).toContain(item.id); expect(item.defaultDirectory).toBeUndefined();
  }
  await expect(stat(directory)).rejects.toThrow();
});

test('工作区另一会话运行命令时拒绝重新定位，真正停止后才允许提交', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const directory = join(workbench.dataDir, '命令运行目录');
  const target = join(workbench.dataDir, '命令新目录');
  await mkdir(directory); await mkdir(target);
  const first = (await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json()).conversation;
  const second = await (await page.request.post(`${workbench.url}/api/conversations`, { data: { workspaceId: first.workspaceId } })).json();
  const preview = await (await page.request.post(`${workbench.url}/api/conversations/${first.id}/directory/preview`, { data: { path: target } })).json();
  const input = { path: preview.path, expectedPath: preview.previousPath, expectedVersion: preview.version, confirmed: true };
  await page.goto(`${workbench.url}/conversations/${second.id}`);
  upstream.enqueue({ chunks: [{ toolCall: { id: 'running-command', name: 'powershell', arguments: JSON.stringify({ command: '[Console]::WriteLine("停止前的真实命令输出"); Start-Sleep -Seconds 30' }) } }] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('执行命令后尝试定位');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: /powershell .*运行中/ }).click();
  await expect(page.getByTestId('tool-output')).toContainText('停止前的真实命令输出');
  const rejected = await page.request.post(`${workbench.url}/api/conversations/${first.id}/directory/relocate`, { data: input });
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).error).toContain('未完成任务');
  expect((await (await page.request.get(`${workbench.url}/api/workspaces`)).json())[0].directory).toBe(directory);
  expect((await page.request.post(`${workbench.url}/api/conversations/${second.id}/stop`)).status()).toBe(200);
  await expect(await revealTool(page, /powershell .*已停止/)).toBeVisible();
  expect((await page.request.post(`${workbench.url}/api/conversations/${first.id}/directory/relocate`, { data: input })).status()).toBe(200);
  expect(upstream.requests).toHaveLength(1);
  await expect(page.getByTestId('tool-output')).toContainText('停止前的真实命令输出');
});

test('普通默认目录丢失在运行准入时拒绝请求，归档工作区不能绕过只读限制重新定位', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const ordinary = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await rename(ordinary.defaultDirectory, `${ordinary.defaultDirectory}-moved`);
  const rejected = await page.request.post(`${workbench.url}/api/conversations/${ordinary.id}/messages`, { data: { content: '无目录时不能准入' } });
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error).toContain('工作目录不可用');
  expect(upstream.requests).toHaveLength(0);
  await expect(stat(ordinary.defaultDirectory)).rejects.toThrow();
  const directory = join(workbench.dataDir, '归档目录');
  const target = join(workbench.dataDir, '归档目标');
  await mkdir(directory); await mkdir(target);
  const session = (await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json()).conversation;
  const preview = await (await page.request.post(`${workbench.url}/api/conversations/${session.id}/directory/preview`, { data: { path: target } })).json();
  expect((await page.request.patch(`${workbench.url}/api/workspaces/${session.workspaceId}`, { data: { archived: true } })).ok()).toBe(true);
  expect((await page.request.post(`${workbench.url}/api/conversations/${session.id}/directory/preview`, { data: { path: target } })).status()).toBe(400);
  const relocated = await page.request.post(`${workbench.url}/api/conversations/${session.id}/directory/relocate`, { data: { path: target, expectedPath: preview.previousPath, expectedVersion: preview.version, confirmed: true } });
  expect(relocated.status()).toBe(409);
  expect((await relocated.json()).error).toContain('已归档');
});

test('真实中断写入待确认时不能重新定位，停止后旧确认在新目录和重启后均失效', async ({ page, workbench, upstream }) => {
  test.setTimeout(60_000);
  await page.goto(workbench.url); await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
  await enableTools(page);
  const session = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  const target = join(workbench.dataDir, '保留不确定写入的新目录');
  const effect = crashAfterFileEffect(workbench, session.defaultDirectory, 'uncertain.txt');
  try {
    upstream.enqueue({ chunks: [{ toolCall: { id: 'relocation-uncertain', name: 'write', arguments: JSON.stringify({ path: 'uncertain.txt', content: 'z'.repeat(4 * 1024 * 1024) }) } }], delayMs: 0 });
    await page.getByRole('textbox', { name: '输入消息' }).fill('产生真实写入后崩溃');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await effect.crashed; await workbench.start(); await page.reload();
    await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible({ timeout: 12_000 });
    const preserved = await readFile(join(session.defaultDirectory, 'uncertain.txt'));
    await rename(session.defaultDirectory, target); await page.reload();
    const rejected = await page.request.post(`${workbench.url}/api/conversations/${session.id}/directory/preview`, { data: { path: target } });
    expect(rejected.status()).toBe(400); expect((await rejected.json()).error).toContain('未完成任务');
    const posted = page.waitForRequest((request) => request.method() === 'POST' && /\/tools\/\d+\/retry$/.test(request.url()));
    await page.getByRole('button', { name: '确认重试', exact: true }).click();
    const oldConfirmation = await posted;
    await expect(page.getByRole('alert')).toContainText('工作目录不可用');
    await page.getByRole('button', { name: '停止本轮', exact: true }).click();
    await expect(await revealTool(page, /write uncertain.txt 已停止/)).toBeVisible();
    const dialog = await previewRelocation(page, target);
    await dialog.getByRole('button', { name: '确认重新定位', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await page.request.post(oldConfirmation.url(), { data: oldConfirmation.postDataJSON() })).status()).toBe(409);
    expect(await readFile(join(target, 'uncertain.txt'))).toEqual(preserved);
    await workbench.stop(); await workbench.start(); await page.reload();
    expect((await page.request.post(oldConfirmation.url(), { data: oldConfirmation.postDataJSON() })).status()).toBe(409);
    await expect(await revealTool(page, /write uncertain.txt 已停止/)).toBeVisible();
    expect(await readFile(join(target, 'uncertain.txt'))).toEqual(preserved);
    expect(upstream.requests).toHaveLength(1);
    await expect(stat(session.defaultDirectory)).rejects.toThrow();
  } finally { effect.close(); }
});

test('并发重新定位只接受一份旧版本，发送竞争始终使用获准目录且不能绕过运行检查', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url); await configureModel(page, upstream.url); await enableTools(page);
  const session = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  const targetA = join(workbench.dataDir, '并发目标甲'); const targetB = join(workbench.dataDir, '并发目标乙');
  await mkdir(targetA); await mkdir(targetB);
  const base = `${workbench.url}/api/conversations/${session.id}/directory`;
  const preview = await (await page.request.post(`${base}/preview`, { data: { path: targetA } })).json();
  const input = { path: preview.path, expectedPath: preview.previousPath, expectedVersion: preview.version, confirmed: true };
  expect((await page.request.post(`${base}/relocate`, { data: { ...input, confirmed: false } })).status()).toBe(409);
  const responses = await Promise.all([targetA, targetB].map((path) => page.request.post(`${base}/relocate`, { data: { ...input, path } })));
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const current = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  expect(current.directoryVersion).toBe(1);
  await expect(page.getByRole('button', { name: '打开工作目录', exact: true })).toHaveAttribute('title', current.defaultDirectory);
  const otherTarget = current.defaultDirectory === targetA ? targetB : targetA;
  await writeFile(join(current.defaultDirectory, 'root.txt'), '原获准位置');
  await writeFile(join(otherTarget, 'root.txt'), '新获准位置');
  const next = await (await page.request.post(`${base}/preview`, { data: { path: otherTarget } })).json();
  upstream.enqueue({ chunks: ['占住运行再读取', { toolCall: { id: 'race-directory-read', name: 'read', arguments: '{"path":"root.txt"}' } }], pauseAfter: 0 });
  upstream.enqueue({ chunks: ['竞争流程结束'] });
  const [sent, relocated] = await Promise.all([
    page.request.post(`${workbench.url}/api/conversations/${session.id}/messages`, { data: { content: '与目录更新并发提交' } }),
    page.request.post(`${base}/relocate`, { data: { path: next.path, expectedPath: next.previousPath, expectedVersion: next.version, confirmed: true } }),
  ]);
  expect(sent.status()).toBe(202);
  expect([200, 409]).toContain(relocated.status());
  await expect.poll(() => upstream.requests.length).toBe(1);
  upstream.release();
  await expect.poll(() => upstream.requests.length).toBe(2);
  expect(JSON.stringify(upstream.requests[1].messages)).toContain(relocated.ok() ? '新获准位置' : '原获准位置');
  await expect.poll(() => upstream.finishedResponses).toBe(2);
  expect((await page.request.post(`${base}/relocate`, { data: input })).status()).toBe(409);
});

test('已打开页面发现普通目录失效后立即展示修复入口，失败输入保留且不启动模型', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const session = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await rename(session.defaultDirectory, `${session.defaultDirectory}-moved`);
  await page.getByRole('textbox', { name: '输入消息' }).fill('目录丢失时保留的输入');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('工作目录不可用');
  await expect(page.getByRole('button', { name: '重新定位工作目录', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '输入消息' })).toHaveValue('目录丢失时保留的输入');
  expect(upstream.requests).toHaveLength(0);
});
