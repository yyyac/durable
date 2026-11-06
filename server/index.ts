import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { SettingsStore } from './settings.js';
import { Runtime, context, stateFrom } from './runtime.js';
import { ConversationBusy } from '@earendil-works/pi-durable';
import { streamSSE } from 'hono/streaming';
import { listConversations, titleConversation, renameConversation, archiveConversation } from './conversations.js';
import { openLocalDirectory } from './directories.js';

const app = new Hono();
const settings = new SettingsStore(resolve(process.env.WORKBENCH_DATA_DIR ?? '.data'));
await settings.load();
const runtime = await Runtime.open(settings);
app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/settings', (c) => c.json(settings.summary()));
app.put('/api/settings', async (c) => {
  try { return c.json(await settings.save(await c.req.json())); }
  catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.put('/api/settings/selection', async (c) => {
  try { return c.json(await settings.select(await c.req.json())); }
  catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.get('/api/conversation', (c) => c.json({ id: String(runtime.root.id) }));
app.get('/api/conversations', async (c) => c.json(await listConversations(runtime.harness, c.req.query('includeArchived') === 'true')));
app.post('/api/conversations', async (c) => {
  const conversation = await runtime.createConversation();
  const summaries = await listConversations(runtime.harness);
  return c.json(summaries.find((item) => item.id === String(conversation.id))!, 201);
});
app.patch('/api/conversations/:id', async (c) => {
  try {
    const input = await c.req.json();
    const conversation = await runtime.conversation(c.req.param('id'));
    if (typeof input.title === 'string') await renameConversation(runtime.harness, conversation.id, input.title);
    else if (input.archived === true) await archiveConversation(runtime.harness, conversation.id);
    else throw new Error('会话操作无效');
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.post('/api/conversations/:id/messages', async (c) => {
  try {
    const input = await c.req.json();
    if (typeof input.content !== 'string' || !input.content.trim()) return c.json({ error: '请输入消息' }, 400);
    const conversation = await runtime.conversation(c.req.param('id'));
    const id = await runtime.send(conversation, input.content.trim(), input.modelSelection);
    await titleConversation(runtime.harness, conversation.id, input.content);
    return c.json({ id }, 202);
  } catch (error) {
    return c.json({ error: error instanceof ConversationBusy ? '当前会话正在生成，请等待完成' : (error as Error).message }, error instanceof ConversationBusy ? 409 : 400);
  }
});
app.post('/api/conversations/:id/retry', async (c) => {
  try {
    const body = await c.req.text();
    const input = body ? JSON.parse(body) : {};
    const conversation = await runtime.conversation(c.req.param('id'));
    const id = await runtime.retry(conversation, input.modelSelection);
    return id === null ? c.json({ error: '当前回复无法重试' }, 409) : c.json({ id }, 202);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});
app.post('/api/conversations/:id/stop', async (c) => {
  try {
    await runtime.stop(await runtime.conversation(c.req.param('id')));
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.post('/api/conversations/:id/directory/open', async (c) => {
  try {
    const conversation = await runtime.conversation(c.req.param('id'));
    await openLocalDirectory(await runtime.requireDirectory(conversation));
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.get('/api/conversations/:id/events', async (c) => {
  const conversation = await runtime.conversation(c.req.param('id'));
  return streamSSE(c, async (stream) => {
    const watch = await conversation.watch(context);
    stream.onAbort(() => { void watch.stop(); });
    try {
      const entries = new Map((await runtime.olderEntries(conversation, watch.value)).map((entry) => [entry.id, entry]));
      const publish = async (view: typeof watch.value) => {
        for (const entry of view.entries) entries.set(entry.id, entry);
        const modelContext = await conversation.context(context, { at: view.entries.at(-1)?.id ?? view.before });
        await stream.writeSSE({ event: 'state', data: JSON.stringify({ ...stateFrom(view, [...entries.values()], modelContext.messages, await runtime.thinking.read(conversation.id)), directory: await runtime.directory(conversation) }) });
      };
      await publish(watch.value);
      watch.start(async (call) => { if (call.kind === 'value') await publish(call.value); });
      await watch.closed;
    } finally { await watch.stop(); }
  });
});
app.use('/*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 3100) });
async function shutdown() {
  server.close();
  if ('closeAllConnections' in server) server.closeAllConnections();
  await runtime.harness.close(context);
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
