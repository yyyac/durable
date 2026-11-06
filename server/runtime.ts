import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { Message } from '@earendil-works/pi-ai';
import { estimateContextTokens, estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate';
import { configure, ConversationBusy, createRegistry, Harness, LiveDoc, type Conversation, type ConversationView, type EntryRecord, type Cursor, type ConversationId, type Tx } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { join } from 'node:path';
import type { ChatMessage, ConversationState, ContentBlock, ModelSelection } from '../src/types.js';
import { SettingsStore, type StoredSettings } from './settings.js';
import { addConversation, listConversations } from './conversations.js';
import { canRetryReply } from '../src/types.js';
import { ThinkingClock, timingKey, type ThinkingTimings } from './thinking-timing.js';
import { allocateDefaultDirectory, inspectDirectory } from './directories.js';

export const context = BACKGROUND_CONTEXT;
const STOP_ENTRY_KIND = 'workbench.stop';
type StoppedAttempt = { taskId: number; timestamp: number | null };

function modelsFor(settings: StoredSettings | null) {
  const models = createModels();
  if (!settings) return models;
  for (const service of settings.services) models.setProvider(createProvider({
    id: service.id,
    baseUrl: service.baseUrl,
    auth: { apiKey: { name: 'API Key', resolve: async () => ({ auth: { apiKey: service.apiKey } }) } },
    models: service.models.map((model) => ({
      id: model.modelId, name: model.name, provider: service.id, api: service.protocol,
      baseUrl: service.baseUrl, reasoning: model.supportsThinking, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
    })),
    api: service.protocol === 'anthropic-messages' ? anthropicMessagesApi() : service.protocol === 'openai-responses' ? openAIResponsesApi() : openAICompletionsApi(),
  }));
  return models;
}

function readableFailure(text: string | undefined) {
  if (!text) return text;
  const start = text.indexOf('{');
  if (start < 0) return text;
  try {
    const payload = JSON.parse(text.slice(start)) as { error?: { message?: unknown }; message?: unknown };
    const message = payload?.error?.message ?? payload?.message;
    return typeof message === 'string' && message ? message : text;
  } catch { return text; }
}

function displayMessage(id: string, message: Message, taskId: number | undefined, timings: ThinkingTimings): ChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const content: ContentBlock[] = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content.flatMap((block, index): ContentBlock[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }];
    if (block.type === 'thinking' && block.thinking && !block.redacted) return [{ type: 'thinking', thinking: block.thinking, timing: timings.blocks[timingKey(taskId, message.timestamp, index)] }];
    return [];
  });
  return { id, role: message.role, content, timestamp: message.timestamp, ...(message.role === 'assistant' ? { stopReason: message.stopReason, errorMessage: readableFailure(message.errorMessage) } : {}) };
}

export function stateFrom(view: ConversationView, entries: readonly EntryRecord[], modelContext: readonly Message[], timings: ThinkingTimings = { blocks: {} }): ConversationState {
  const live = view.docs['pi.live'] as { run?: { taskId: number }; generation?: { message?: Message }; runFailure?: { reason: string; detail?: string } } | undefined;
  const usage = estimateContextTokens(modelContext);
  const usageMessage = usage.lastUsageIndex === null ? undefined : modelContext[usage.lastUsageIndex];
  const partial = live?.generation?.message;
  const partialTokens = partial && !modelContext.some((message) => message.role === 'assistant' && message.timestamp === partial.timestamp) ? estimateMessageTokens(partial) : 0;
  const stopped = entries.filter((entry) => entry.kind === STOP_ENTRY_KIND).map((entry) => entry.data as StoppedAttempt);
  const messages = entries.flatMap((entry) => (entry.model ?? []).flatMap((message, index) => {
    const projected = displayMessage(`${entry.id}:${index}`, message, entry.byTaskId, timings);
    if (projected?.stopReason === 'aborted') {
      projected.termination = stopped.some((attempt) => attempt.taskId === entry.byTaskId && (attempt.timestamp === null || attempt.timestamp === message.timestamp)) ? 'stopped' : 'interrupted';
    }
    return projected ? [projected] : [];
  }));
  return {
    id: String(view.conversation.id),
    messages,
    generation: live?.generation?.message ? displayMessage(`live:${live.run?.taskId}`, live.generation.message, live.run?.taskId, timings) : null,
    busy: Boolean(live?.run),
    contextUsage: {
      tokens: usage.tokens + partialTokens,
      estimated: usage.trailingTokens > 0 || partialTokens > 0,
      model: usageMessage?.role === 'assistant' ? { provider: usageMessage.provider, modelId: usageMessage.model } : undefined,
    },
    failure: live?.runFailure ? { ...live.runFailure, detail: readableFailure(live.runFailure.detail) } : undefined,
  };
}

export class Runtime {
  private constructor(readonly harness: Harness, readonly root: Conversation, readonly settings: SettingsStore, readonly thinking: ThinkingClock) {}
  static async open(settings: SettingsStore) {
    const storage = await openNodeSqliteStorage(join(settings.directory, 'workbench.sqlite'));
    const harness = await Harness.open(storage, { models: () => modelsFor(settings.value), registry: createRegistry(), settings: { stream: { maxRetries: 0 }, compaction: { enabled: false } } }, context);
    const root = await harness.root(context, { agent: { tools: [], modelTools: [] } });
    await harness.commit((tx) => addConversation(tx, root.id), context);
    for (const item of await listConversations(harness, true)) {
      await harness.commit((tx) => allocateDefaultDirectory(tx, Number(item.id) as ConversationId, settings.directory), context);
    }
    const thinking = new ThinkingClock(harness);
    for (const item of await listConversations(harness, true)) await thinking.observe(Number(item.id) as ConversationId);
    harness.resume();
    return new Runtime(harness, root, settings, thinking);
  }
  async createConversation() {
    const conversation = await this.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { tools: [], modelTools: [] }, init: async (tx, id) => {
      await addConversation(tx, id);
      await allocateDefaultDirectory(tx, id, this.settings.directory);
    } }, context);
    await this.thinking.observe(conversation.id);
    return conversation;
  }
  async conversation(id: string) {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId < 0) throw new Error('会话不存在');
    const conversation = await this.harness.conversation(numericId as ConversationId, context);
    if (!conversation) throw new Error('会话不存在');
    return conversation;
  }
  async directory(conversation: Conversation) {
    const item = (await listConversations(this.harness, true)).find((item) => item.id === String(conversation.id));
    if (!item?.defaultDirectory) throw new Error('会话没有工作目录');
    return inspectDirectory(item.defaultDirectory);
  }
  async requireDirectory(conversation: Conversation) {
    const directory = await this.directory(conversation);
    if (!directory.available) throw new Error('工作目录不可用，原目录可能已移动或删除；历史记录仍然保留');
    return directory.path;
  }
  private async configure(tx: Tx, conversation: Conversation, selection?: ModelSelection) {
    const { service, model } = this.settings.model(selection);
    await configure(tx, conversation.id, { model: { provider: service.id, modelId: model.modelId }, thinkingLevel: model.supportsThinking ? 'medium' : 'off', tools: [], modelTools: [] });
  }
  async send(conversation: Conversation, content: string, selection?: ModelSelection) {
    const id = await conversation.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversation.id);
      if (live.run) throw new ConversationBusy(conversation.id);
      await this.configure(tx, conversation, selection);
      return conversation.submit(tx, { type: 'input', content, whenBusy: 'reject' });
    }, context);
    this.harness.resume();
    return id;
  }
  async retry(conversation: Conversation, selection?: ModelSelection) {
    const id = await conversation.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversation.id);
      if (live.run || !canRetryReply(live.runFailure)) return null;
      await this.configure(tx, conversation, selection);
      return conversation.submit(tx, { type: 'continue' });
    }, context);
    if (id !== null) this.harness.resume();
    return id;
  }
  async stop(conversation: Conversation) {
    const taskId = await conversation.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversation.id);
      if (live.run) {
        await tx.appendEntry(conversation.id, { kind: STOP_ENTRY_KIND, data: { taskId: live.run.taskId, timestamp: live.generation?.message?.timestamp ?? null } });
        return live.run.taskId;
      }
    }, context);
    if (taskId !== undefined) await this.harness.abortTask(taskId, context);
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
