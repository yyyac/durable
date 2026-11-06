import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createRegistry, defineDoc, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
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

export async function openLegacyRunningWorkbench(directory: string, upstreamUrl: string, count: number) {
  const context = BACKGROUND_CONTEXT;
  const models = createModels();
  models.setProvider(createProvider({
    id: 'capacity-service', baseUrl: upstreamUrl,
    auth: { apiKey: { name: 'API Key', resolve: async () => ({ auth: { apiKey: 'capacity-test-key' } }) } },
    models: [{ id: 'model-a', name: '模型甲', provider: 'capacity-service', api: 'openai-completions', baseUrl: upstreamUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384 }],
    api: openAICompletionsApi(),
  }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'workbench.sqlite')), { registry: createRegistry(), models }, context);
  try {
    for (let index = 0; index < count; index++) {
      const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'capacity-service', modelId: 'model-a' }, tools: [], modelTools: [] }, init: async (tx, id) => {
        (await tx.doc(LegacyConversationsDoc)).items.push({ id: String(id), title: `旧版运行${index}`, createdAt: 1700000000000 + index });
      } }, context);
      await conversation.submit({ type: 'input', content: `旧版问题${index}`, whenBusy: 'reject' }, context);
    }
    return harness;
  } catch (error) { await harness.close(context); throw error; }
}
