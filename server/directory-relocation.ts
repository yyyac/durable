import { LiveDoc, type ConversationId, type Tx } from '@earendil-works/pi-durable';
import { ConversationsDoc } from './conversations.js';
import { WorkspacesDoc, existingDirectory, requireConversationActive } from './workspaces.js';
import { conversationDirectory, inspectDirectory } from './directories.js';
import type { DirectoryRelocation } from '../src/types.js';
import { realpath } from 'node:fs/promises';
import { hasUnfinishedCalls } from './tool-calls.js';

export async function directoryBinding(tx: Tx, conversationId: ConversationId) {
  const item = (await tx.doc(ConversationsDoc)).items.find((item) => item.id === String(conversationId));
  if (!item) throw new Error('会话不存在');
  const workspaces = await tx.doc(WorkspacesDoc);
  const workspace = item.workspaceId ? workspaces.items.find((workspace) => workspace.id === item.workspaceId) : undefined;
  return { item, workspace, path: conversationDirectory(item, workspaces.items), version: (workspace ?? item).directoryVersion ?? 0 };
}

export async function requireBoundDirectory(tx: Tx, conversationId: ConversationId, expectedPath?: string, expectedVersion?: number) {
  await requireConversationActive(tx, conversationId);
  const binding = await directoryBinding(tx, conversationId);
  if (expectedPath !== undefined && (binding.path !== expectedPath || (expectedVersion !== undefined && binding.version !== expectedVersion))) throw new Error('原工作目录关联已变更，不能执行旧调用');
  if (!(await inspectDirectory(binding.path)).available) throw new Error('工作目录不可用，原目录可能已移动或删除；历史记录仍然保留');
  return { path: binding.path, version: binding.version };
}

export async function previewRelocation(tx: Tx, conversationId: ConversationId, path: unknown): Promise<DirectoryRelocation> {
  await requireConversationActive(tx, conversationId);
  const binding = await directoryBinding(tx, conversationId);
  await requireRelocationIdle(tx, conversationId, binding.item.workspaceId);
  const target = await relocationTarget(tx, binding.item.workspaceId, path);
  return { previousPath: binding.path, version: binding.version, path: target };
}

async function requireRelocationIdle(tx: Tx, conversationId: ConversationId, workspaceId: string | undefined) {
  const sessions = (await tx.doc(ConversationsDoc)).items.filter((item) => workspaceId ? item.workspaceId === workspaceId : item.id === String(conversationId));
  for (const session of sessions) {
    const id = Number(session.id) as ConversationId;
    if ((await tx.doc(LiveDoc, id)).run || await hasUnfinishedCalls(tx, id)) throw new Error(`会话“${session.title || '新会话'}”仍有未完成任务，请先停止运行中或待确认任务再重新定位`);
  }
}

async function relocationTarget(tx: Tx, workspaceId: string | undefined, input: unknown) {
  const path = await existingDirectory(input);
  for (const workspace of (await tx.doc(WorkspacesDoc)).items) {
    if (workspace.id === workspaceId) continue;
    const actual = await realpath(workspace.directory).catch(() => undefined);
    if (workspace.directory === path || actual === path) throw new Error('该目录已被其他工作区使用，请选择其他目录');
  }
  return path;
}

export async function relocateDirectory(tx: Tx, conversationId: ConversationId, input: { path?: unknown; expectedPath?: unknown; expectedVersion?: unknown; confirmed?: unknown }) {
  if (input.confirmed !== true) throw new Error('请明确确认原目录与新目录');
  await requireConversationActive(tx, conversationId);
  const binding = await directoryBinding(tx, conversationId);
  if (input.expectedPath !== binding.path || input.expectedVersion !== binding.version) throw new Error('目录关联已变更，请重新检查并确认路径');
  await requireRelocationIdle(tx, conversationId, binding.item.workspaceId);
  const path = await relocationTarget(tx, binding.item.workspaceId, input.path);
  if (path !== input.path) throw new Error('目标目录已变化，请重新检查并确认实际路径');
  if (binding.workspace) binding.workspace.directory = path;
  else binding.item.defaultDirectory = path;
  (binding.workspace ?? binding.item).directoryVersion = binding.version + 1;
  return { path, available: true, version: binding.version + 1 };
}
