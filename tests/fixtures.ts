import { test as base, expect } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

type Plan = { chunks: Array<string | { thinking: string } | { redacted: string }>; pauseAfter?: number; failure?: { status: number; message: string }; streamError?: string };
type UpstreamRequest = { model: string; messages: Array<{ role: string; content: unknown }>; reasoning_effort?: string };

export class Upstream {
  readonly requests: UpstreamRequest[] = [];
  readonly plans: Plan[] = [];
  abortedResponses = 0;
  private releases: Array<() => void> = [];
  readonly server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    this.requests.push(JSON.parse(body));
    res.on('close', () => { if (!res.writableEnded) this.abortedResponses++; });
    const plan = this.plans.shift() ?? { chunks: ['测试回复'] };
    if (plan.failure) {
      res.writeHead(plan.failure.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: plan.failure.message } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (new URL(req.url ?? '/', 'http://localhost').pathname.endsWith('/messages')) {
      await this.messages(res, plan);
      return;
    }
    this.chunk(res, { role: 'assistant' });
    for (const [index, block] of plan.chunks.entries()) {
      this.chunk(res, typeof block === 'string' ? { content: block } : 'thinking' in block ? { reasoning_content: block.thinking } : { reasoning_details: [{ type: 'reasoning.encrypted', data: block.redacted }] });
      if (plan.pauseAfter === index) await new Promise<void>((resolve) => this.releases.push(resolve));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    res.write(`data: ${JSON.stringify({ id: 'chat-test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  private chunk(res: ServerResponse, delta: object) {
    res.write(`data: ${JSON.stringify({ id: 'chat-test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  private async messages(res: ServerResponse, plan: Plan) {
    const event = (type: string, value: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    event('message_start', { message: { id: 'msg-test', type: 'message', role: 'assistant', model: 'test-model', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    let blockIndex = -1;
    let previousType = '';
    for (const [index, block] of plan.chunks.entries()) {
      const type = typeof block === 'string' ? 'text' : 'thinking' in block ? 'thinking' : 'redacted_thinking';
      if (type !== previousType || type === 'redacted_thinking') {
        if (blockIndex >= 0) event('content_block_stop', { index: blockIndex });
        blockIndex++;
        event('content_block_start', { index: blockIndex, content_block: type === 'text' ? { type, text: '' } : type === 'thinking' ? { type, thinking: '' } : { type, data: typeof block === 'object' && 'redacted' in block ? block.redacted : '' } });
        previousType = type;
      }
      if (typeof block === 'string') event('content_block_delta', { index: blockIndex, delta: { type: 'text_delta', text: block } });
      else if ('thinking' in block) event('content_block_delta', { index: blockIndex, delta: { type: 'thinking_delta', thinking: block.thinking } });
      if (plan.pauseAfter === index) await new Promise<void>((resolve) => this.releases.push(resolve));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (blockIndex >= 0) event('content_block_stop', { index: blockIndex });
    if (plan.streamError) {
      event('error', { error: { type: 'invalid_request_error', message: plan.streamError } });
      res.end();
      return;
    }
    event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
    event('message_stop', {});
    res.end();
  }
  enqueue(plan: Plan) { this.plans.push(plan); }
  release() { this.releases.splice(0).forEach((resolve) => resolve()); }
  async start() { this.server.listen(0, '127.0.0.1'); await once(this.server, 'listening'); }
  get url() { return `http://127.0.0.1:${(this.server.address() as { port: number }).port}/v1`; }
  async close() { this.release(); this.server.closeAllConnections(); this.server.close(); }
}

export class Workbench {
  private process?: ChildProcess;
  private output = '';
  constructor(readonly dataDir: string, readonly port: number) {}
  get url() { return `http://127.0.0.1:${this.port}`; }
  async start() {
    this.output = '';
    this.process = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, PORT: String(this.port), WORKBENCH_DATA_DIR: this.dataDir },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process.stdout?.on('data', (value) => { this.output += String(value); });
    this.process.stderr?.on('data', (value) => { this.output += String(value); });
    for (let count = 0; count < 100; count++) {
      try { if ((await fetch(`${this.url}/api/health`)).ok) return; } catch {}
      if (this.process.exitCode !== null) throw new Error(this.output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`工作台未启动：${this.output}`);
  }
  async stop() {
    if (!this.process || this.process.exitCode !== null) return;
    const exited = once(this.process, 'exit');
    this.process.kill();
    await exited;
  }
  async crash() {
    if (!this.process || this.process.exitCode !== null) return;
    const exited = once(this.process, 'exit');
    this.process.kill('SIGKILL');
    await exited;
  }
}

export const test = base.extend<{ workbench: Workbench; upstream: Upstream }>({
  upstream: async ({}, use) => {
    const upstream = new Upstream();
    await upstream.start();
    try { await use(upstream); } finally { await upstream.close(); }
  },
  workbench: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-workbench-test-'));
    const portServer = createServer();
    portServer.listen(0, '127.0.0.1');
    await once(portServer, 'listening');
    const port = (portServer.address() as { port: number }).port;
    await new Promise<void>((resolve) => portServer.close(() => resolve()));
    const workbench = new Workbench(dir, port);
    await workbench.start();
    try { await use(workbench); } finally { await workbench.stop(); await rm(dir, { recursive: true, force: true }); }
  },
});

export { expect };
