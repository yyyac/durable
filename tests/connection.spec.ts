import { createServer, request, type ServerResponse, type ClientRequest } from 'node:http';
import { once } from 'node:events';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function configure(page: Page, upstreamUrl: string) {
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('接口地址').fill(upstreamUrl);
  await page.getByLabel('API Key', { exact: true }).fill('connection-test-key');
  await page.getByLabel('模型 ID').fill('test-model');
  await page.getByLabel('模型名称').fill('连接测试模型');
  await page.getByRole('button', { name: '保存配置' }).click();
}

class ConnectionProxy {
  private available = true;
  private streams = new Map<ServerResponse, ClientRequest>();
  private server = createServer((incoming, outgoing) => {
    const isSubscription = incoming.url?.endsWith('/events');
    if (isSubscription && !this.available) {
      outgoing.writeHead(503).end();
      return;
    }
    const forwarded = request(new URL(incoming.url ?? '/', this.target), {
      method: incoming.method, headers: incoming.headers,
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    forwarded.on('error', () => outgoing.destroy());
    if (isSubscription) this.streams.set(outgoing, forwarded);
    outgoing.on('close', () => { this.streams.delete(outgoing); forwarded.destroy(); });
    incoming.pipe(forwarded);
  });
  constructor(private target: string) {}
  async start() { this.server.listen(0, '127.0.0.1'); await once(this.server, 'listening'); }
  get url() { return `http://127.0.0.1:${(this.server.address() as { port: number }).port}`; }
  disconnect() {
    this.available = false;
    for (const [response, forwarded] of this.streams) { response.destroy(); forwarded.destroy(); }
  }
  reconnect() { this.available = true; }
  async close() { this.server.closeAllConnections(); await new Promise<void>((resolve) => this.server.close(() => resolve())); }
}

test('订阅中断自动接续后台生成，不重发输入或误报模型失败', async ({ page, workbench, upstream }) => {
  const proxy = new ConnectionProxy(workbench.url);
  await proxy.start();
  try {
    await page.goto(proxy.url);
    await configure(page, upstream.url);
    upstream.enqueue({ chunks: ['断线前内容', '，断线期间的完整尾段。'], pauseAfter: 0 });
    const responseFinished = new Promise<void>((resolve) => {
      upstream.server.once('request', (_request, response) => response.once('finish', resolve));
    });
    await page.getByRole('textbox', { name: '输入消息' }).fill('连接测试问题');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByTestId('assistant-message')).toHaveText('断线前内容');
    proxy.disconnect();
    await expect(page.getByRole('status')).toHaveText('连接已断开，正在重连…');
    await expect(page.getByTestId('assistant-message')).toHaveText('断线前内容');
    await expect(page.getByRole('alert')).toHaveCount(0);
    upstream.release();
    await responseFinished;
    proxy.reconnect();
    await expect(page.getByTestId('assistant-message')).toHaveText('断线前内容，断线期间的完整尾段。');
    await expect(page.getByTestId('assistant-message')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0].messages.filter((message) => message.role === 'user')).toEqual([{ role: 'user', content: '连接测试问题' }]);
  } finally { await proxy.close(); }
});

test('正文生成中刷新先恢复当前内容，再接续同一任务的尾段', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configure(page, upstream.url);
  upstream.enqueue({ chunks: ['刷新前已生成', '，刷新后接续的尾段。'], pauseAfter: 0 });
  await page.getByRole('textbox', { name: '输入消息' }).fill('刷新测试问题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('刷新前已生成');
  await page.reload();
  await expect(page.getByTestId('assistant-message')).toHaveText('刷新前已生成');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled();
  upstream.release();
  await expect(page.getByTestId('assistant-message')).toHaveText('刷新前已生成，刷新后接续的尾段。');
  await expect(page.getByTestId('assistant-message')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(1);
});

test('关闭网页后后台完成回复，重新打开只读取已有最终答案', async ({ page, context, workbench, upstream }) => {
  await page.goto(workbench.url);
  await configure(page, upstream.url);
  upstream.enqueue({ chunks: ['关闭前的正文', '，无人订阅时完成的答案。'], pauseAfter: 0 });
  const responseFinished = new Promise<void>((resolve) => {
    upstream.server.once('request', (_request, response) => response.once('finish', resolve));
  });
  await page.getByRole('textbox', { name: '输入消息' }).fill('关闭网页测试问题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('关闭前的正文');
  await page.close();
  upstream.release();
  await responseFinished;
  const reopened = await context.newPage();
  await reopened.goto(workbench.url);
  await expect(reopened.getByTestId('assistant-message')).toHaveText('关闭前的正文，无人订阅时完成的答案。');
  await expect(reopened.getByTestId('assistant-message')).toHaveCount(1);
  await expect(reopened.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(upstream.requests).toHaveLength(1);
});
