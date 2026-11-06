import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createRegistry, defineDoc, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { join } from 'node:path';

const LegacyConversationsDoc = defineDoc({
  kind: 'workbench.conversations', version: 1, scope: 'session',
  initial: (): { items: Array<{ id: string; title: string; createdAt: number; archived?: boolean }> } => ({ items: [] }),
  checkpointWhen: () => true,
});

export async function seedLegacyWorkbench(directory: string) {
  const context = BACKGROUND_CONTEXT;
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'workbench.sqlite')), { registry: createRegistry(), models: () => createModels() }, context);
  try {
    const root = await harness.root(context, { agent: { tools: [], modelTools: [] } });
    await harness.commit(async (tx) => {
      (await tx.doc(LegacyConversationsDoc)).items.push({ id: String(root.id), title: '旧版历史', createdAt: 1700000000000 });
      await tx.appendEntry(root.id, { kind: 'input', model: [{ role: 'user', content: '旧版问题', timestamp: 1700000000000 }] });
      await tx.appendEntry(root.id, { kind: 'reply', model: [{
        role: 'assistant', content: [{ type: 'text', text: '旧版已经完成的回答' }], timestamp: 1700000001000,
        api: 'openai-completions', provider: 'configured', model: 'test-model', stopReason: 'stop',
        usage: { input: 10, output: 10, totalTokens: 20, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }] });
    }, context);
    await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { tools: [], modelTools: [] }, init: async (tx, id) => {
      (await tx.doc(LegacyConversationsDoc)).items.push({ id: String(id), title: '旧版归档', createdAt: 1700000002000, archived: true });
    } }, context);
  } finally { await harness.close(context); }
}
