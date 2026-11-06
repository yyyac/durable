import { mkdir, writeFile, readdir, rename, stat, symlink, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { configureModel } from './configure-model';

async function addWorkspace(page: Page, path: string) {
  await page.getByRole('button', { name: '选择工作目录', exact: true }).click();
  await page.getByRole('menuitem', { name: '填写文件夹路径…' }).click();
  const dialog = page.getByRole('dialog', { name: '添加工作区' });
  await dialog.getByRole('textbox', { name: '文件夹绝对路径' }).fill(path);
  await dialog.getByRole('checkbox', { name: '我已了解并信任此工作区的本机工具访问' }).check();
  await dialog.getByRole('button', { name: '添加并开始会话' }).click();
  await expect(dialog).not.toBeVisible();
}

test('工作区确认后真实读取，空会话切换目录创建新身份且不改变普通会话信任', async ({ page, workbench, upstream }) => {
  const directory = join(workbench.dataDir, '用户项目');
  await mkdir(directory);
  await writeFile(join(directory, 'shared.txt'), '工作区的真实共享文件');
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const originalUrl = page.url();
  const original = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await addWorkspace(page, directory);
  expect(page.url()).not.toBe(originalUrl);
  const items = await (await page.request.get(`${workbench.url}/api/conversations`)).json();
  const workspaceSession = items[0];
  expect(workspaceSession.workspaceId).toBeTruthy();
  expect(workspaceSession.defaultDirectory).toBeUndefined();
  expect(items.find((item: { id: string }) => item.id === original.id)).toEqual(original);
  await expect(page.getByRole('button', { name: '启用本机工具', exact: true })).toHaveCount(0);
  upstream.enqueue({ chunks: [{ toolCall: { id: 'workspace-read', name: 'read', arguments: '{"path":"shared.txt"}' } }] });
  upstream.enqueue({ chunks: ['已读取工作区文件'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('只属于工作区甲的独特问题');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('已读取工作区文件');
  expect(JSON.stringify(upstream.requests[1].messages)).toContain('工作区的真实共享文件');
  expect(upstream.requests[0].tools?.map((item) => (item as { function: { name: string } }).function.name).sort()).toEqual(['edit', 'powershell', 'read', 'write']);
  await page.goto(originalUrl);
  await expect(page.getByRole('button', { name: '启用本机工具', exact: true })).toBeVisible();
  upstream.enqueue({ chunks: ['普通会话仍可纯聊天'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('保持纯聊天');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('普通会话仍可纯聊天');
  expect(upstream.requests[2].tools ?? []).toHaveLength(0);
  expect(await readdir(directory)).toEqual(['shared.txt']);
});

test('侧栏工作区重命名和新建，共享真实文件但上下文独立，刷新重启保留归属', async ({ page, workbench, upstream }) => {
  const directory = join(workbench.dataDir, '共享项目');
  await mkdir(directory);
  await writeFile(join(directory, 'shared.txt'), '两会话共享的文件');
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  await addWorkspace(page, directory);
  const firstUrl = page.url();
  const before = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  await page.getByRole('button', { name: '共享项目的工作区菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重命名工作区' });
  await dialog.getByRole('textbox', { name: '工作区名称' }).fill('研究文件');
  await dialog.getByRole('button', { name: '保存名称' }).click();
  await expect(dialog).not.toBeVisible();
  upstream.enqueue({ chunks: [{ toolCall: { id: 'shared-read', name: 'read', arguments: '{"path":"shared.txt"}' } }] });
  upstream.enqueue({ chunks: ['甲的独特回答'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('甲的独特上下文');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('甲的独特回答');
  await page.getByRole('button', { name: '在研究文件中新建会话' }).click();
  await expect(page).not.toHaveURL(firstUrl);
  const secondUrl = page.url();
  upstream.enqueue({ chunks: [{ toolCall: { id: 'shared-read', name: 'read', arguments: '{"path":"shared.txt"}' } }] });
  upstream.enqueue({ chunks: ['乙的独立回答'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('乙的独立问题');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('乙的独立回答');
  expect(JSON.stringify(upstream.requests[3].messages)).toContain('两会话共享的文件');
  expect(JSON.stringify(upstream.requests[2].messages)).not.toContain('甲的独特');
  expect(JSON.stringify(upstream.requests[3].messages)).not.toContain('甲的独特');
  const workspaces = await (await page.request.get(`${workbench.url}/api/workspaces`)).json();
  expect(workspaces).toHaveLength(1);
  expect(workspaces[0]).toMatchObject({ id: before.workspaceId, name: '研究文件' });
  await page.getByRole('button', { name: '折叠研究文件工作区' }).click();
  await expect(page.getByRole('button', { name: '甲的独特上下文', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '乙的独立问题', exact: true })).toBeVisible();
  await workbench.stop();
  await workbench.start();
  await page.reload();
  expect(page.url()).toBe(secondUrl);
  await expect(page.getByTestId('assistant-message').last()).toHaveText('乙的独立回答');
  expect(await (await page.request.get(`${workbench.url}/api/workspaces`)).json()).toEqual(workspaces);
  const after = await (await page.request.get(`${workbench.url}/api/conversations`)).json();
  for (const item of after.filter((item: { workspaceId?: string }) => item.workspaceId)) {
    expect(item.workspaceId).toBe(before.workspaceId);
    expect(item.defaultDirectory).toBeUndefined();
    await expect(stat(join(workbench.dataDir, 'sessions', item.id))).rejects.toThrow();
  }
  await page.goto(firstUrl);
  await expect(page.getByTestId('assistant-message').last()).toHaveText('甲的独特回答');
  expect(upstream.requests).toHaveLength(4);
});

test('无效路径和未确认访问不产生记录，已创建会话不能通过接口改变归属', async ({ page, workbench, upstream }) => {
  const directory = join(workbench.dataDir, '有效目录');
  const file = join(workbench.dataDir, '普通文件.txt');
  await mkdir(directory);
  await writeFile(file, '不是目录');
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const originalUrl = page.url();
  const original = await (await page.request.get(`${workbench.url}/api/conversations`)).json();
  await page.getByRole('textbox', { name: '输入消息' }).fill('取消后保留的草稿');
  await page.getByRole('button', { name: '选择工作目录', exact: true }).click();
  await page.getByRole('menuitem', { name: '填写文件夹路径…' }).click();
  const dialog = page.getByRole('dialog', { name: '添加工作区' });
  await expect(dialog).toContainText('并非目录沙箱');
  await dialog.getByRole('textbox', { name: '文件夹绝对路径' }).fill(file);
  await expect(dialog.getByRole('button', { name: '添加并开始会话' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '添加并开始会话' }).click();
  await expect(dialog.getByRole('alert')).toContainText('文件夹不可用');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '输入消息' })).toHaveValue('取消后保留的草稿');
  expect(page.url()).toBe(originalUrl);
  for (const path of ['', 'relative/path', 'C:relative', file, join(directory, 'missing')]) {
    const response = await page.request.post(`${workbench.url}/api/workspaces`, { data: { path, trusted: true } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  }
  expect((await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory } })).status()).toBe(400);
  expect((await page.request.post(`${workbench.url}/api/conversations`, { data: { workspaceId: '不存在' } })).status()).toBe(400);
  expect(await (await page.request.get(`${workbench.url}/api/conversations`)).json()).toEqual(original);
  expect(await (await page.request.get(`${workbench.url}/api/workspaces`)).json()).toEqual([]);
  const created = await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } });
  expect(created.status()).toBe(201);
  const session = (await created.json()).conversation;
  const mutation = await page.request.patch(`${workbench.url}/api/conversations/${original[0].id}`, { data: { title: '试图移动空会话', workspaceId: session.workspaceId } });
  expect(mutation.status()).toBe(400);
  const after = await (await page.request.get(`${workbench.url}/api/conversations`)).json();
  expect(after.find((item: { id: string }) => item.id === original[0].id)).toEqual(original[0]);
});

test('Windows 实际目录别名并发添加复用身份，父子工作区分别保留真实共享关系', async ({ page, workbench, upstream }) => {
  test.skip(process.platform !== 'win32', '验证真实 Windows junction 与路径大小写');
  const directory = join(workbench.dataDir, 'ActualProject');
  const child = join(directory, 'Child');
  const alias = join(workbench.dataDir, 'AliasProject');
  await mkdir(child, { recursive: true });
  await symlink(directory, alias, 'junction');
  await writeFile(join(child, 'shared.txt'), '父子目录的同一份文件');
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  await addWorkspace(page, alias);
  const first = (await (await page.request.get(`${workbench.url}/api/workspaces`)).json())[0];
  expect(first.directory).toBe(directory);
  expect((await page.request.patch(`${workbench.url}/api/workspaces/${first.id}`, { data: { name: '规范化项目' } })).ok()).toBe(true);
  const variants = [directory.toLowerCase(), directory.toUpperCase(), directory.replaceAll('\\', '/'), `${directory}\\Child\\..`, alias];
  const responses = await Promise.all(variants.map((path) => page.request.post(`${workbench.url}/api/workspaces`, { data: { path, trusted: true } })));
  for (const response of responses) {
    expect(response.status()).toBe(201);
    expect((await response.json()).conversation.workspaceId).toBe(first.id);
  }
  const current = await (await page.request.get(`${workbench.url}/api/workspaces`)).json();
  expect(current).toHaveLength(1);
  expect(current[0].name).toBe('规范化项目');
  await page.reload();
  await addWorkspace(page, child);
  const workspaces = await (await page.request.get(`${workbench.url}/api/workspaces`)).json();
  expect(workspaces).toHaveLength(2);
  expect(workspaces[0].id).not.toBe(first.id);
  upstream.enqueue({ chunks: [{ toolCall: { id: 'child-read', name: 'read', arguments: '{"path":"shared.txt"}' } }] });
  upstream.enqueue({ chunks: ['子工作区读取成功'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('读取子目录文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('子工作区读取成功');
  await page.getByRole('button', { name: '在规范化项目中新建会话' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveCount(0);
  upstream.enqueue({ chunks: [{ toolCall: { id: 'parent-read', name: 'read', arguments: '{"path":"Child/shared.txt"}' } }] });
  upstream.enqueue({ chunks: ['父工作区读取成功'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('读取父目录文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('父工作区读取成功');
  expect(JSON.stringify(upstream.requests[1].messages)).toContain('父子目录的同一份文件');
  expect(JSON.stringify(upstream.requests[3].messages)).toContain('父子目录的同一份文件');
  expect(await readdir(child)).toEqual(['shared.txt']);
});

test('工作区目录失效保留历史，拒绝发送重试和新建且不重建旧目录', async ({ page, workbench, upstream }) => {
  const directory = join(workbench.dataDir, '会被移动的项目');
  await mkdir(directory);
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  await addWorkspace(page, directory);
  const originalUrl = page.url();
  const session = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  upstream.enqueue({ chunks: ['目录失效后仍保留的历史'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('保留历史');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('目录失效后仍保留的历史');
  upstream.enqueue({ chunks: [], failure: { status: 401, message: '可重试的失败' } });
  await page.getByRole('textbox', { name: '输入消息' }).fill('失败后重试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试回复', exact: true })).toBeVisible();
  await rename(directory, `${directory}-moved`);
  const before = await (await page.request.get(`${workbench.url}/api/conversations`)).json();
  for (const [url, data] of [
    [`/api/conversations/${session.id}/messages`, { content: '目录丢失后不应开始' }],
    [`/api/conversations/${session.id}/retry`, {}],
    ['/api/conversations', { workspaceId: session.workspaceId }],
  ] as const) {
    const response = await page.request.post(`${workbench.url}${url}`, { data });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('工作目录不可用');
  }
  await page.getByRole('button', { name: '在会被移动的项目中新建会话' }).click();
  await expect(page.getByRole('alert').last()).toContainText('工作目录不可用');
  expect(page.url()).toBe(originalUrl);
  expect(await (await page.request.get(`${workbench.url}/api/conversations`)).json()).toEqual(before);
  await workbench.stop();
  await workbench.start();
  await page.reload();
  await expect(page.getByText('工作目录不可用', { exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-message').first()).toHaveText('目录失效后仍保留的历史');
  await expect(stat(directory)).rejects.toThrow();
  expect(upstream.requests).toHaveLength(2);
});

test('目录菜单在已有工作区和默认目录间切换始终新建会话，长路径可辨识且普通授权保留', async ({ page, workbench, upstream }) => {
  const directory = join(workbench.dataDir, 'LongProjectDirectory'.repeat(5));
  await mkdir(directory);
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  await page.getByRole('button', { name: '启用本机工具', exact: true }).click();
  await page.getByRole('dialog', { name: '启用本机工具' }).getByRole('button', { name: '确认启用', exact: true }).click();
  await addWorkspace(page, directory);
  const workspaceUrl = page.url();
  const workspace = (await (await page.request.get(`${workbench.url}/api/workspaces`)).json())[0];
  await page.getByRole('button', { name: '选择工作目录', exact: true }).click();
  const option = page.getByRole('menuitem').filter({ hasText: workspace.name });
  await expect(option).toHaveAttribute('title', directory);
  const menuBox = await page.getByRole('menu').boundingBox();
  expect(menuBox!.width).toBeLessThanOrEqual(384);
  await page.getByRole('menuitem', { name: /^默认工作目录/ }).click();
  await expect(page).not.toHaveURL(workspaceUrl);
  const ordinaryUrl = page.url();
  const ordinary = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  expect(ordinary.workspaceId).toBeUndefined();
  expect(ordinary.defaultDirectory).toBeTruthy();
  await expect(page.getByRole('button', { name: '启用本机工具', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '选择工作目录', exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: workspace.name }).click();
  await expect(page).not.toHaveURL(ordinaryUrl);
  expect(page.url()).not.toBe(workspaceUrl);
  const newest = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  expect(newest.workspaceId).toBe(workspace.id);
  await page.goto(ordinaryUrl);
  await writeFile(join(ordinary.defaultDirectory, 'ordinary.txt'), '普通授权仍有效');
  upstream.enqueue({ chunks: [{ toolCall: { id: 'ordinary-read', name: 'read', arguments: '{"path":"ordinary.txt"}' } }] });
  upstream.enqueue({ chunks: ['普通读取完成'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('继续普通目录读取');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('普通读取完成');
  expect(JSON.stringify(upstream.requests[1].messages)).toContain('普通授权仍有效');
});

test('Windows 省略盘符的根相对路径即使实际存在也明确拒绝', async ({ page, workbench }) => {
  test.skip(process.platform !== 'win32', '验证 Windows 当前盘符相对路径');
  const directory = await mkdtemp(join(process.cwd(), 'test-results', 'root-relative-'));
  try {
    await page.goto(workbench.url);
    for (const path of [directory.slice(2), directory.slice(2).replaceAll('\\', '/')]) {
      const response = await page.request.post(`${workbench.url}/api/workspaces`, { data: { path, trusted: true } });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toContain('绝对路径');
    }
    expect(await (await page.request.get(`${workbench.url}/api/workspaces`)).json()).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
