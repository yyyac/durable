import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { Message } from '@earendil-works/pi-ai';
import { createRegistry, Harness, type Conversation, type ConversationView, type EntryRecord, type Cursor, type ConversationId } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { join } from 'node:path';
import type { ChatMessage, ConversationState, ContentBlock } from '../src/types.js';
import { SettingsStore, type StoredSettings } from './settings.js';
import { addConversation } from './conversations.js';

export const context = BACKGROUND_CONTEXT;

function modelsFor(settings: StoredSettings | null) {
  const models = createModels();
  if (!settings) return models;
  models.setProvider(createProvider({
    id: 'configured',
    baseUrl: settings.baseUrl,
    auth: { apiKey: { name: 'API Key', resolve: async () => ({ auth: { apiKey: settings.apiKey } }) } },
    models: [{
      id: settings.modelId, name: settings.name, provider: 'configured', api: 'openai-completions',
      baseUrl: settings.baseUrl, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384,
    }],
    api: openAICompletionsApi(),
  }));
  return models;
}

function displayMessage(id: string, message: Message): ChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const content: ContentBlock[] = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content.flatMap((block): ContentBlock[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }];
    if (block.type === 'thinking' && block.thinking) return [{ type: 'thinking', thinking: block.thinking }];
    return [];
  });
  return { id, role: message.role, content, timestamp: message.timestamp, ...(message.role === 'assistant' ? { stopReason: message.stopReason } : {}) };
}

export function stateFrom(view: ConversationView, entries: readonly EntryRecord[]): ConversationState {
  const live = view.docs['pi.live'] as { run?: { taskId: string }; generation?: { message?: Message }; runFailure?: { reason: string; detail?: string } } | undefined;
  const messages = entries.flatMap((entry) => (entry.model ?? []).flatMap((message, index) => {
    const projected = displayMessage(`${entry.id}:${index}`, message);
    return projected ? [projected] : [];
  }));
  return {
    id: String(view.conversation.id),
    messages,
    generation: live?.generation?.message ? displayMessage(`live:${live.run?.taskId}`, live.generation.message) : null,
    busy: Boolean(live?.run),
    failure: live?.runFailure,
  };
}

export class Runtime {
  private constructor(readonly harness: Harness, readonly root: Conversation, readonly settings: SettingsStore) {}
  static async open(settings: SettingsStore) {
    const storage = await openNodeSqliteStorage(join(settings.directory, 'workbench.sqlite'));
    const harness = await Harness.open(storage, { models: () => modelsFor(settings.value), registry: createRegistry(), settings: { stream: { maxRetries: 0 }, compaction: { enabled: false } } }, context);
    const root = await harness.root(context, { agent: { tools: [], modelTools: [] } });
    await harness.commit((tx) => addConversation(tx, root.id), context);
    return new Runtime(harness, root, settings);
  }
  async createConversation() {
    return this.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { tools: [], modelTools: [] }, init: addConversation }, context);
  }
  async conversation(id: string) {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId < 0) throw new Error('会话不存在');
    const conversation = await this.harness.conversation(numericId as ConversationId, context);
    if (!conversation) throw new Error('会话不存在');
    return conversation;
  }
  async prepare(conversation: Conversation) {
    if (!this.settings.value) throw new Error('尚未配置模型');
    await conversation.configure({ model: { provider: 'configured', modelId: this.settings.value.modelId }, tools: [], modelTools: [] }, context);
  }
  async olderEntries(conversation: Conversation, view: ConversationView) {
    const entries: EntryRecord[] = [];
    if (!view.before) return entries;
    let cursor: Cursor | undefined;
    do {
      const page = await conversation.entries({ order: 'ascending', maxEntryId: view.before }, 100, cursor, context);
      entries.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return entries;
  }
}
