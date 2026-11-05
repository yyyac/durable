import { test as base, expect } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

type Plan = { chunks: string[]; pauseAfter?: number };
type UpstreamRequest = { model: string; messages: Array<{ role: string; content: unknown }> };

export class Upstream {
  readonly requests: UpstreamRequest[] = [];
  readonly plans: Plan[] = [];
  private releases: Array<() => void> = [];
  readonly server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    this.requests.push(JSON.parse(body));
    const plan = this.plans.shift() ?? { chunks: ['测试回复'] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    this.chunk(res, { role: 'assistant' });
    for (const [index, text] of plan.chunks.entries()) {
      this.chunk(res, { content: text });
      if (plan.pauseAfter === index) await new Promise<void>((resolve) => this.releases.push(resolve));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    res.write(`data: ${JSON.stringify({ id: 'chat-test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  private chunk(res: ServerResponse, delta: object) {
    res.write(`data: ${JSON.stringify({ id: 'chat-test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
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
