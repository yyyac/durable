import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { SettingsStore } from './settings.js';
import { Runtime, context, stateFrom } from './runtime.js';
import { ConversationBusy, type ConversationId } from '@earendil-works/pi-durable';
import { streamSSE } from 'hono/streaming';
import { ConversationsDoc, listConversations, titleConversation, renameConversation, archiveConversation } from './conversations.js';
import { openLocalDirectory } from './directories.js';
import { previewRelocation, relocateDirectory } from './directory-relocation.js';
import { ToolCallsDoc } from './tool-calls.js';
import { confirmToolCall } from './tool-recovery.js';
import { ArchivedWorkspace, WorkspacesDoc, renameWorkspace, setWorkspaceArchived } from './workspaces.js';
import { RunCapacityReached } from './run-admission.js';
import { selectLocalDirectory } from './folder-picker.js';

const app = new Hono();
const settings = new SettingsStore(resolve(process.env.WORKBENCH_DATA_DIR ?? '.data'));
await settings.load();
const runtime = await Runtime.open(settings);
app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/local-tools', async (c) => c.json({ enabled: await runtime.toolsEnabled() }));
app.post('/api/local-tools/enable', async (c) => {
  await runtime.enableTools();
  return c.json({ enabled: true });
});
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
app.get('/api/conversations', async (c) => {
  const items = await listConversations(runtime.harness, c.req.query('includeArchived') === 'true');
  return c.json(await Promise.all(items.map(async (item) => ({ ...item, awaitingConfirmation: (await runtime.harness.snapshot(ToolCallsDoc, Number(item.id) as ConversationId, context))?.items.some((call) => call.status === 'awaiting') ?? false }))));
});
app.post('/api/conversations', async (c) => {
  try {
    const body = await c.req.text();
    const input = body ? JSON.parse(body) : {};
    if (input.workspaceId !== undefined && (typeof input.workspaceId !== 'string' || !input.workspaceId)) throw new Error('工作区无效');
    const conversation = await runtime.createConversation({ workspaceId: input.workspaceId });
    const summaries = await listConversations(runtime.harness);
    return c.json(summaries.find((item) => item.id === String(conversation.id))!, 201);
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.get('/api/workspaces', async (c) => c.json((await runtime.harness.snapshot(WorkspacesDoc, context))?.items ?? []));
app.post('/api/directories/select', async (c) => {
  try { return c.json({ path: await selectLocalDirectory() }); }
  catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.post('/api/workspaces', async (c) => {
  try {
    const input = await c.req.json();
    if (input.path === undefined) throw new Error('请输入文件夹绝对路径');
    const conversation = await runtime.createConversation({ path: input.path, trusted: input.trusted });
    const item = (await listConversations(runtime.harness)).find((item) => item.id === String(conversation.id))!;
    return c.json({ conversation: item }, 201);
  } catch (error) { return c.json({ error: (error as Error).message, ...(error instanceof ArchivedWorkspace ? { workspaceId: error.workspaceId } : {}) }, 400); }
});
app.patch('/api/workspaces/:id', async (c) => {
  try {
    const input = await c.req.json();
    const directory = await runtime.harness.commit(async (tx) => {
      if (typeof input.archived === 'boolean') return setWorkspaceArchived(tx, c.req.param('id'), input.archived);
      else await renameWorkspace(tx, c.req.param('id'), input.name);
    }, context);
    return c.json({ ok: true, ...(directory ? { directory } : {}) });
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.patch('/api/conversations/:id', async (c) => {
  try {
    const input = await c.req.json();
    if ('workspaceId' in input || 'defaultDirectory' in input) throw new Error('会话创建后不能改变工作区归属；请选择目录创建新会话');
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
    return c.json({ error: error instanceof ConversationBusy ? '当前会话正在生成，请等待完成' : (error as Error).message }, error instanceof ConversationBusy || error instanceof RunCapacityReached ? 409 : 400);
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
    return c.json({ error: (error as Error).message }, error instanceof RunCapacityReached ? 409 : 400);
  }
});
app.post('/api/conversations/:id/stop', async (c) => {
  try {
    await runtime.stop(await runtime.conversation(c.req.param('id')));
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.post('/api/conversations/:id/tools/:key/stop', async (c) => {
  try {
    const input = await c.req.json();
    if (!Number.isSafeInteger(input.attempt)) throw new Error('确认代次无效');
    await runtime.stop(await runtime.conversation(c.req.param('id')), { key: c.req.param('key'), attempt: input.attempt });
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: (error as Error).message }, 409); }
});
app.post('/api/conversations/:id/tools/:key/retry', async (c) => {
  try {
    const input = await c.req.json();
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) throw new Error('确认代次无效');
    const conversation = await runtime.conversation(c.req.param('id'));
    return c.json(await confirmToolCall(runtime.harness, conversation.id, c.req.param('key'), input.attempt, context), 202);
  } catch (error) { return c.json({ error: (error as Error).message }, 409); }
});
app.post('/api/conversations/:id/directory/open', async (c) => {
  try {
    const conversation = await runtime.conversation(c.req.param('id'));
    await openLocalDirectory(await runtime.requireDirectory(conversation));
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.post('/api/conversations/:id/directory/preview', async (c) => {
  try {
    const input = await c.req.json();
    const conversation = await runtime.conversation(c.req.param('id'));
    return c.json(await runtime.harness.commit((tx) => previewRelocation(tx, conversation.id, input.path), context));
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});
app.post('/api/conversations/:id/directory/relocate', async (c) => {
  try {
    const input = await c.req.json();
    const conversation = await runtime.conversation(c.req.param('id'));
    return c.json(await runtime.harness.commit((tx) => relocateDirectory(tx, conversation.id, input), context));
  } catch (error) { return c.json({ error: (error as Error).message }, 409); }
});
app.get('/api/conversations/:id/events', async (c) => {
  const conversation = await runtime.conversation(c.req.param('id'));
  return streamSSE(c, async (stream) => {
    const watch = await conversation.watch(context);
    const toolWatch = await runtime.harness.watchDoc(ToolCallsDoc, conversation.id, context);
    const workspaceWatch = await runtime.harness.watchDoc(WorkspacesDoc, context);
    const directoryWatch = await runtime.harness.watchDoc(ConversationsDoc, context);
    stream.onAbort(() => { void watch.stop(); void toolWatch?.stop(); void workspaceWatch?.stop(); void directoryWatch?.stop(); });
    try {
      const entries = new Map((await runtime.olderEntries(conversation, watch.value)).map((entry) => [entry.id, entry]));
      const publish = async (view: typeof watch.value) => {
        for (const entry of view.entries) entries.set(entry.id, entry);
        const modelContext = await conversation.context(context, { at: view.entries.at(-1)?.id ?? view.before });
        const calls = (await runtime.harness.snapshot(ToolCallsDoc, conversation.id, context))?.items ?? [];
        const workspaces = (await runtime.harness.snapshot(WorkspacesDoc, context))?.items ?? [];
        await stream.writeSSE({ event: 'state', data: JSON.stringify({ ...stateFrom(view, [...entries.values()], modelContext.messages, await runtime.thinking.read(conversation.id), calls), directory: await runtime.directory(conversation), workspaces }) });
      };
      let latestView = watch.value;
      let pending = Promise.resolve();
      const schedulePublish = () => { pending = pending.then(() => publish(latestView)).catch(() => { void watch.stop(); }); };
      await publish(watch.value);
      watch.start(async (call) => { if (call.kind === 'value') { latestView = call.value; schedulePublish(); } });
      toolWatch?.start(async () => { schedulePublish(); });
      workspaceWatch?.start(async () => { schedulePublish(); });
      directoryWatch?.start(async () => { schedulePublish(); });
      await watch.closed;
    } finally { await watch.stop(); await toolWatch?.stop(); await workspaceWatch?.stop(); await directoryWatch?.stop(); }
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
