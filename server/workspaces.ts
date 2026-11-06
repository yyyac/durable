import { defineDoc, LiveDoc, type ConversationId, type DocumentReader, type Tx } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord/context';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, parse } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Workspace } from '../src/types.js';
import { ConversationsDoc } from './conversations.js';
import { hasUnfinishedCalls } from './tool-calls.js';
import { inspectDirectory } from './directories.js';

export const ARCHIVED_WORKSPACE_MESSAGE = '工作区已归档，请先恢复工作区后继续';

export class ArchivedWorkspace extends Error {
  constructor(readonly workspaceId: string) { super(ARCHIVED_WORKSPACE_MESSAGE); }
}

function requireActive(workspace: Workspace) {
  if (workspace.archived) throw new ArchivedWorkspace(workspace.id);
  return workspace;
}

export const WorkspacesDoc = defineDoc({
  kind: 'workbench.workspaces', version: 1, scope: 'session',
  initial: (): { items: Workspace[] } => ({ items: [] }), checkpointWhen: () => true,
});

async function existingDirectory(path: unknown) {
  if (typeof path !== 'string' || !path.trim() || !isAbsolute(path) || (process.platform === 'win32' && parse(path).root.length === 1)) throw new Error('请输入已经存在的文件夹绝对路径');
  try {
    const directory = await realpath(path);
    if (!(await stat(directory)).isDirectory()) throw new Error();
    return directory;
  } catch { throw new Error('文件夹不可用，请检查目录是否存在且为文件夹'); }
}

export async function bindWorkspace(tx: Tx, path: unknown, trusted: unknown) {
  if (trusted !== true) throw new Error('请先确认本机工具访问说明');
  const directory = await existingDirectory(path);
  const index = await tx.doc(WorkspacesDoc);
  const existing = index.items.find((item) => item.directory === directory);
  if (existing) return requireActive(existing);
  const workspace: Workspace = { id: randomUUID(), name: basename(directory) || directory, directory, createdAt: Date.now() };
  index.items.unshift(workspace);
  return workspace;
}

export async function requireWorkspace(tx: Tx, id: string) {
  const workspace = (await tx.doc(WorkspacesDoc)).items.find((item) => item.id === id);
  if (!workspace) throw new Error('工作区不存在');
  requireActive(workspace);
  try { await existingDirectory(workspace.directory); }
  catch { throw new Error('工作目录不可用，原目录可能已移动或删除；历史记录仍然保留'); }
  return workspace;
}

export async function renameWorkspace(tx: Tx, id: string, name: unknown) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('请输入工作区名称');
  if (Array.from(name.trim()).length > 120) throw new Error('工作区名称不能超过 120 个字');
  const workspace = (await tx.doc(WorkspacesDoc)).items.find((item) => item.id === id);
  if (!workspace) throw new Error('工作区不存在');
  requireActive(workspace);
  workspace.name = name.trim();
}

export async function requireConversationActive(tx: Tx, conversationId: ConversationId) {
  const item = (await tx.doc(ConversationsDoc)).items.find((item) => item.id === String(conversationId));
  if (!item?.workspaceId) return;
  const workspace = (await tx.doc(WorkspacesDoc)).items.find((workspace) => workspace.id === item.workspaceId);
  if (!workspace) throw new Error('工作区不存在');
  requireActive(workspace);
}

export async function checkConversationActive(reader: DocumentReader, conversationId: ConversationId, context: Context) {
  const item = (await reader.snapshot(ConversationsDoc, context))?.items.find((item) => item.id === String(conversationId));
  if (!item?.workspaceId) return;
  const workspace = (await reader.snapshot(WorkspacesDoc, context))?.items.find((workspace) => workspace.id === item.workspaceId);
  if (!workspace) throw new Error('工作区不存在');
  requireActive(workspace);
}

export async function setWorkspaceArchived(tx: Tx, id: string, archived: boolean) {
  const workspace = (await tx.doc(WorkspacesDoc)).items.find((item) => item.id === id);
  if (!workspace) throw new Error('工作区不存在');
  if (archived) {
    const sessions = (await tx.doc(ConversationsDoc)).items.filter((item) => item.workspaceId === id);
    for (const session of sessions) {
      const conversationId = Number(session.id) as ConversationId;
      if ((await tx.doc(LiveDoc, conversationId)).run || await hasUnfinishedCalls(tx, conversationId)) throw new Error('工作区仍有运行中或待确认任务，请先停止或等待完成后归档');
    }
  }
  const directory = !archived ? await inspectDirectory(workspace.directory) : undefined;
  workspace.archived = archived;
  return directory;
}
