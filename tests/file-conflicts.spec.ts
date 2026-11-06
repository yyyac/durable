import { readFile, writeFile, mkdir, link, symlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { configureModel } from './configure-model';
import type { Page } from '@playwright/test';
import type { Upstream } from './fixtures';
import { crashAfterFileEffect } from './write-effect';

async function send(page: Page, input: string) {
  await page.getByRole('textbox', { name: '输入消息' }).fill(input);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}
function tool(upstream: Upstream, name: string, args: object, id = name) {
  upstream.enqueue({ chunks: [{ toolCall: { id, name, arguments: JSON.stringify(args) } }] });
}

test('同一会话成功读取后可以覆盖真实已有文件，模型收到修改结果', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  const path = join(conversation.defaultDirectory, 'existing.txt');
  await writeFile(path, '已有原文');
  await page.request.post(`${workbench.url}/api/local-tools/enable`);
  await page.reload();
  upstream.enqueue({ chunks: [{ toolCall: { id: 'read-existing', name: 'read', arguments: '{"path":"existing.txt"}' } }] });
  upstream.enqueue({ chunks: [{ toolCall: { id: 'overwrite-existing', name: 'write', arguments: '{"path":"existing.txt","content":"读取后覆盖的新内容"}' } }] });
  upstream.enqueue({ chunks: ['完成先读后改'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('读取后修改已有文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('完成先读后改');
  expect(await readFile(path, 'utf8')).toBe('读取后覆盖的新内容');
  expect(JSON.stringify(upstream.requests[1].messages)).toContain('已有原文');
  expect(JSON.stringify(upstream.requests[2].messages)).toContain('Successfully wrote');
  await expect(page.getByRole('button', { name: /write existing.txt 已完成/ })).toHaveCount(1);
});

test('未读拒绝覆盖和编辑，其他会话的成功读取不能授权当前会话', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const directory = join(workbench.dataDir, 'shared-project'); await mkdir(directory);
  const path = join(directory, 'private.txt'); await writeFile(path, '各自读取后才能修改');
  const first = (await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: directory, trusted: true } })).json()).conversation;
  const second = await (await page.request.post(`${workbench.url}/api/conversations`, { data: { workspaceId: first.workspaceId } })).json();
  await page.goto(`${workbench.url}/conversations/${first.id}`);
  tool(upstream, 'read', { path: 'private.txt' }); upstream.enqueue({ chunks: ['甲已读取'] });
  await send(page, '甲先读取'); await expect(page.getByTestId('assistant-message').last()).toHaveText('甲已读取');
  await page.goto(`${workbench.url}/conversations/${second.id}`);
  for (const name of ['write', 'edit']) {
    tool(upstream, name, name === 'write' ? { path: 'private.txt', content: '不应覆盖' } : { path: 'private.txt', edits: [{ oldText: '各自', newText: '擅自' }] });
    upstream.enqueue({ chunks: [`${name}未读已拒绝`] }); await send(page, `乙未读取尝试${name}`);
    await expect(page.getByTestId('assistant-message').last()).toHaveText(`${name}未读已拒绝`);
    await expect(page.getByRole('button', { name: new RegExp(`${name} private.txt 失败`) })).toHaveCount(1);
    expect(await readFile(path, 'utf8')).toBe('各自读取后才能修改');
    expect(JSON.stringify(upstream.requests.at(-1)!.messages)).toContain('当前会话成功读取');
  }
});

test('读取后外部改动返回真实冲突，模型重新读取才能修改新版本', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  const path = join(conversation.defaultDirectory, 'external.txt'); await writeFile(path, '原版本');
  await page.request.post(`${workbench.url}/api/local-tools/enable`); await page.reload();
  tool(upstream, 'read', { path: 'external.txt' }); upstream.enqueue({ chunks: ['已读原版本'] });
  await send(page, '先读取'); await expect(page.getByTestId('assistant-message').last()).toHaveText('已读原版本');
  await writeFile(path, '外部编辑器的新版本');
  tool(upstream, 'write', { path: 'external.txt', content: '过期的改动' }); upstream.enqueue({ chunks: ['冲突后先保留外部修改'] });
  await send(page, '尝试旧修改'); await expect(page.getByTestId('assistant-message').last()).toHaveText('冲突后先保留外部修改');
  expect(await readFile(path, 'utf8')).toBe('外部编辑器的新版本');
  expect(JSON.stringify(upstream.requests[3].messages)).toContain('文件冲突');
  await page.getByRole('button', { name: /write external.txt 失败/ }).click();
  await expect(page.getByTestId('tool-output').last()).toContainText('重新读取');
  tool(upstream, 'read', { path: 'external.txt' });
  tool(upstream, 'edit', { path: 'external.txt', edits: [{ oldText: '外部编辑器的新版本', newText: '基于新版本的修改' }] });
  upstream.enqueue({ chunks: ['重读后处理完成'] }); await send(page, '重新读取后编辑');
  await expect(page.getByTestId('assistant-message').last()).toHaveText('重读后处理完成');
  expect(await readFile(path, 'utf8')).toBe('基于新版本的修改');
});

test('精确编辑拒绝智能引号模糊匹配、重复文本和重叠范围', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  const path = join(conversation.defaultDirectory, 'exact.txt');
  const content = 'smart “quote”  \r\nrepeat\r\nrepeat\r\n'; await writeFile(path, content);
  await page.request.post(`${workbench.url}/api/local-tools/enable`); await page.reload();
  tool(upstream, 'read', { path: 'exact.txt' }); upstream.enqueue({ chunks: ['精确匹配前已读取'] });
  await send(page, '读取待编辑文件'); await expect(page.getByTestId('assistant-message').last()).toHaveText('精确匹配前已读取');
  const cases = [
    { edits: [{ oldText: 'smart "quote"', newText: '不能模糊改' }], error: '完全一致' },
    { edits: [{ oldText: 'repeat', newText: '不能任选一次' }], error: '不唯一' },
    { edits: [{ oldText: 'smart “quote”', newText: 'A' }, { oldText: '“quote”', newText: 'B' }], error: '重叠' },
  ];
  for (const [index, item] of cases.entries()) {
    tool(upstream, 'edit', { path: 'exact.txt', edits: item.edits }, `rejected-${index}`); upstream.enqueue({ chunks: [`精确拒绝${index}`] });
    await send(page, `拒绝不精确改动${index}`); await expect(page.getByTestId('assistant-message').last()).toHaveText(`精确拒绝${index}`);
    expect(await readFile(path, 'utf8')).toBe(content); expect(JSON.stringify(upstream.requests.at(-1)!.messages)).toContain(item.error);
  }
});

test('父子工作区及 junction 和硬链接别名竞争覆盖和编辑同一真实文件，只有一次修改成功', async ({ page, workbench, upstream }) => {
  test.setTimeout(60_000); test.skip(process.platform !== 'win32', '覆盖真实Windows目录别名');
  await page.goto(workbench.url); await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
  const parent = join(workbench.dataDir, 'actual'); const child = join(parent, 'child'); const alias = join(workbench.dataDir, 'junction');
  await mkdir(child, { recursive: true }); await symlink(parent, alias, 'junction');
  const original = join(child, 'original.txt'); const hardlink = join(child, 'hardlink.txt');
  const body = 'shared-original\n'.repeat(32_768);
  await writeFile(original, 'unique-original-head\n' + body); await link(original, hardlink);
  const first = (await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: alias, trusted: true } })).json()).conversation;
  const second = (await (await page.request.post(`${workbench.url}/api/workspaces`, { data: { path: child, trusted: true } })).json()).conversation;
  for (const [session, path] of [[first, 'child/original.txt'], [second, 'hardlink.txt']] as const) {
    await page.goto(`${workbench.url}/conversations/${session.id}`);
    tool(upstream, 'read', { path, limit: 1 }, `read-${session.id}`); upstream.enqueue({ chunks: [`会话${session.id}已读`] });
    await send(page, '先读取共享文件'); await expect(page.getByTestId('assistant-message').last()).toHaveText(`会话${session.id}已读`);
  }
  const a = '甲的完整改动'.repeat(100_000), b = '乙的完整改动'.repeat(100_000);
  upstream.enqueue({ chunks: [{ toolCall: { id: 'compete-a', name: 'edit', arguments: JSON.stringify({ path: 'child/original.txt', edits: [{ oldText: 'unique-original-head', newText: a }] }) } }], pauseAfter: 0, delayMs: 0 });
  upstream.enqueue({ chunks: [{ toolCall: { id: 'compete-b', name: 'write', arguments: JSON.stringify({ path: 'hardlink.txt', content: b }) } }], pauseAfter: 0, delayMs: 0 });
  upstream.enqueue({ chunks: ['竞争已结束'] }); upstream.enqueue({ chunks: ['竞争已结束'] });
  expect((await page.request.post(`${workbench.url}/api/conversations/${first.id}/messages`, { data: { content: '甲竞争修改' } })).ok()).toBe(true);
  await expect.poll(() => upstream.requests.length).toBe(5);
  expect((await page.request.post(`${workbench.url}/api/conversations/${second.id}/messages`, { data: { content: '乙竞争修改' } })).ok()).toBe(true);
  await expect.poll(() => upstream.requests.length).toBe(6); upstream.release();
  await expect.poll(() => upstream.requests.length).toBe(8);
  let completed = 0, failed = 0;
  for (const session of [first, second]) {
    await page.goto(`${workbench.url}/conversations/${session.id}`);
    await expect(page.getByTestId('assistant-message').last()).toHaveText('竞争已结束');
    completed += await page.getByRole('button', { name: /(?:write|edit) .* 已完成/ }).count();
    failed += await page.getByRole('button', { name: /(?:write|edit) .* 失败/ }).count();
  }
  expect(completed).toBe(1); expect(failed).toBe(1);
  const final = await readFile(original, 'utf8'); expect([a + '\n' + body, b]).toContain(final); expect(await readFile(hardlink, 'utf8')).toBe(final);
  expect(upstream.requests.some((request) => JSON.stringify(request.messages).includes('文件冲突'))).toBe(true);
});

test('精确编辑使用同会话读取版本并保留 UTF-8 BOM 与 Windows CRLF', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configureModel(page, upstream.url);
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  const path = join(conversation.defaultDirectory, 'windows.txt');
  await writeFile(path, '\uFEFF标题\r\nsmart “quote”  \r\n保留尾行\r\n');
  await page.request.post(`${workbench.url}/api/local-tools/enable`);
  await page.reload();
  upstream.enqueue({ chunks: [{ toolCall: { id: 'edit-read', name: 'read', arguments: '{"path":"windows.txt"}' } }] });
  upstream.enqueue({ chunks: [{ toolCall: { id: 'exact-edit', name: 'edit', arguments: JSON.stringify({ path: 'windows.txt', edits: [{ oldText: '标题\nsmart “quote”  ', newText: '新标题\nsmart “quote”  ' }] }) } }] });
  upstream.enqueue({ chunks: ['精确编辑完成'] });
  await page.getByRole('textbox', { name: '输入消息' }).fill('读取后精确编辑');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('assistant-message').last()).toHaveText('精确编辑完成');
  expect(await readFile(path)).toEqual(Buffer.from('\uFEFF新标题\r\nsmart “quote”  \r\n保留尾行\r\n'));
  expect(JSON.stringify(upstream.requests[2].messages)).toContain('Successfully replaced');
  await expect(page.getByRole('button', { name: /edit windows.txt 已完成/ })).toHaveCount(1);
});

for (const name of ['write', 'edit'] as const) {
  test(`${name} 已有文件修改崩溃后保留原前提，拒绝变化并在恢复原版本后幂等确认重试`, async ({ page, workbench, upstream }) => {
    test.setTimeout(90_000);
    await page.goto(workbench.url); await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
    const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
    const path = join(conversation.defaultDirectory, 'recovery-existing.txt'); const original = '修改前的确定版本';
    await writeFile(path, original); await page.request.post(`${workbench.url}/api/local-tools/enable`); await page.reload();
    tool(upstream, 'read', { path: 'recovery-existing.txt' }, 'recovery-read');
    const content = '恢复后的确定内容\n' + 'x'.repeat(4 * 1024 * 1024);
    tool(upstream, name, name === 'write' ? { path: 'recovery-existing.txt', content } : { path: 'recovery-existing.txt', edits: [{ oldText: original, newText: content }] }, 'uncertain-mutation');
    upstream.enqueue({ chunks: [`${name}确认后继续`] });
    const effect = crashAfterFileEffect(workbench, conversation.defaultDirectory, 'recovery-existing.txt', Buffer.from(original));
    try {
      await send(page, '读取并修改已有文件直到中断'); expect(await effect.crashed).toBeGreaterThan(0);
      const partial = await readFile(path); expect(partial.equals(Buffer.from(original))).toBe(false);
      await workbench.start(); await page.reload();
      await expect(page.getByRole('button', { name: '确认重试', exact: true })).toBeVisible({ timeout: 12_000 });
      expect(upstream.requests).toHaveLength(2);
      await writeFile(path, '等待期间外部又修改');
      await page.getByRole('button', { name: '确认重试', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('文件冲突');
      expect(await readFile(path, 'utf8')).toBe('等待期间外部又修改'); expect(upstream.requests).toHaveLength(2);
      await writeFile(path, original);
      const accepted = page.waitForRequest((request) => request.url().endsWith('/retry') && request.method() === 'POST');
      await page.getByRole('button', { name: '确认重试', exact: true }).click();
      const request = await accepted;
      expect((await page.request.post(request.url(), { data: request.postDataJSON() })).ok()).toBe(true);
      await expect(page.getByTestId('assistant-message').last()).toHaveText(`${name}确认后继续`, { timeout: 25_000 });
      expect(await readFile(path, 'utf8')).toBe(content);
      expect(upstream.requests).toHaveLength(3); expect(JSON.stringify(upstream.requests[2].messages)).toContain(name === 'write' ? 'Successfully wrote' : 'Successfully replaced');
      expect((await page.request.post(request.url(), { data: request.postDataJSON() })).ok()).toBe(true);
      await workbench.crash(); await workbench.start(); await page.reload();
      await expect(page.getByRole('button', { name: new RegExp(`${name} recovery-existing.txt 已完成`) })).toHaveCount(1);
      expect(upstream.requests).toHaveLength(3);
    } finally { effect.close(); }
  });

  test(`${name} 已有文件修改中断后停止保留已经产生的效果，不重放原调用`, async ({ page, workbench, upstream }) => {
    test.setTimeout(75_000);
    await page.goto(workbench.url); await configureModel(page, upstream.url, { contextWindow: 4_194_304, maxTokens: 2_097_152 });
    const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
    const path = join(conversation.defaultDirectory, 'stop-existing.txt'); const original = '需要保留已发生改动的原文';
    await writeFile(path, original); await page.request.post(`${workbench.url}/api/local-tools/enable`); await page.reload();
    tool(upstream, 'read', { path: 'stop-existing.txt' });
    const content = '不能自动回滚\n' + 'z'.repeat(4 * 1024 * 1024);
    tool(upstream, name, name === 'write' ? { path: 'stop-existing.txt', content } : { path: 'stop-existing.txt', edits: [{ oldText: original, newText: content }] });
    const effect = crashAfterFileEffect(workbench, conversation.defaultDirectory, 'stop-existing.txt', Buffer.from(original));
    try {
      await send(page, '修改后等待用户处理'); await effect.crashed;
      const partial = await readFile(path); expect(partial.equals(Buffer.from(original))).toBe(false);
      await workbench.start(); await page.reload();
      await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible({ timeout: 12_000 });
      await page.getByRole('button', { name: '停止本轮', exact: true }).click();
      await expect(page.getByRole('button', { name: new RegExp(`${name} stop-existing.txt 已停止`) })).toHaveCount(1);
      expect(await readFile(path)).toEqual(partial); expect(upstream.requests).toHaveLength(2);
      await workbench.crash(); await workbench.start(); await page.reload();
      await expect(page.getByRole('button', { name: new RegExp(`${name} stop-existing.txt 已停止`) })).toHaveCount(1);
      expect(upstream.requests).toHaveLength(2); expect(await readFile(path)).toEqual(partial);
    } finally { effect.close(); }
  });
}

test('读取版本保护仍能完成大文件末行与 offset limit 读取，返回内容来自正确字节范围', async ({ page, workbench, upstream }) => {
  test.setTimeout(90_000);
  await page.goto(workbench.url); await configureModel(page, upstream.url);
  const conversation = (await (await page.request.get(`${workbench.url}/api/conversations`)).json())[0];
  const file = await open(join(conversation.defaultDirectory, 'large.txt'), 'w');
  try { await file.truncate(1024 * 1024 * 1024); await file.write('\n大文件真实末行', 1024 * 1024 * 1024); }
  finally { await file.close(); }
  await page.request.post(`${workbench.url}/api/local-tools/enable`); await page.reload();
  tool(upstream, 'read', { path: 'large.txt', offset: 2, limit: 1 }); upstream.enqueue({ chunks: ['大文件读取完成'] });
  await send(page, '读取一GiB文件的末行'); await expect(page.getByTestId('assistant-message').last()).toHaveText('大文件读取完成', { timeout: 60_000 });
  expect(JSON.stringify(upstream.requests[1].messages)).toContain('大文件真实末行');
  await page.getByRole('button', { name: /read large.txt 已完成/ }).click(); await expect(page.getByTestId('tool-output')).toHaveText('大文件真实末行');
  await writeFile(join(conversation.defaultDirectory, 'ranges.txt'), '\uFEFF一\r\n二\r\n三\r\n四\r\n');
  tool(upstream, 'read', { path: 'ranges.txt', offset: 2, limit: -3 }); upstream.enqueue({ chunks: ['负数limit仍按原有切片语义读取'] });
  await send(page, '读取已有切片范围'); await expect(page.getByTestId('assistant-message').last()).toHaveText('负数limit仍按原有切片语义读取');
  expect(JSON.stringify(upstream.requests[3].messages)).toContain('二\\r\\n三');
});
