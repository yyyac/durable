import { defineDoc, type ConversationId, type Harness, type Tx } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { ConversationSummary } from '../src/types.js';

export const ConversationsDoc = defineDoc({
  kind: 'workbench.conversations',
  version: 1,
  scope: 'session',
  initial: (): { items: ConversationSummary[] } => ({ items: [] }),
  checkpointWhen: () => true,
});

export async function addConversation(tx: Tx, id: ConversationId, workspaceId?: string) {
  const index = await tx.doc(ConversationsDoc);
  if (!index.items.some((item) => item.id === String(id))) {
    index.items.unshift({ id: String(id), title: '', createdAt: Date.now(), ...(workspaceId ? { workspaceId } : {}) });
  }
}

export async function listConversations(harness: Harness, includeArchived = false): Promise<ConversationSummary[]> {
  const index = await harness.snapshot(ConversationsDoc, BACKGROUND_CONTEXT);
  return (index?.items ?? []).filter((item) => includeArchived || !item.archived).map((item) => ({ ...item, title: item.title || '新会话' }));
}

export async function titleConversation(harness: Harness, id: ConversationId, input: string) {
  await harness.commit(async (tx) => {
    const index = await tx.doc(ConversationsDoc);
    const item = index.items.find((item) => item.id === String(id));
    if (item && !item.title) item.title = Array.from(input.replace(/\s+/g, ' ').trim()).slice(0, 40).join('');
  }, BACKGROUND_CONTEXT);
}

export async function renameConversation(harness: Harness, id: ConversationId, title: string) {
  if (!title.trim()) throw new Error('请输入会话名称');
  if (Array.from(title.trim()).length > 120) throw new Error('会话名称不能超过 120 个字');
  await harness.commit(async (tx) => {
    const index = await tx.doc(ConversationsDoc);
    const item = index.items.find((item) => item.id === String(id));
    if (!item) throw new Error('会话不存在');
    item.title = title.trim();
  }, BACKGROUND_CONTEXT);
}

export async function archiveConversation(harness: Harness, id: ConversationId) {
  await harness.commit(async (tx) => {
    const index = await tx.doc(ConversationsDoc);
    const item = index.items.find((item) => item.id === String(id));
    if (!item) throw new Error('会话不存在');
    item.archived = true;
  }, BACKGROUND_CONTEXT);
}
