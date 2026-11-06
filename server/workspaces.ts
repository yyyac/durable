import { defineDoc, type Tx } from '@earendil-works/pi-durable';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, parse } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Workspace } from '../src/types.js';

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
  if (existing) return existing;
  const workspace: Workspace = { id: randomUUID(), name: basename(directory) || directory, directory, createdAt: Date.now() };
  index.items.unshift(workspace);
  return workspace;
}

export async function requireWorkspace(tx: Tx, id: string) {
  const workspace = (await tx.doc(WorkspacesDoc)).items.find((item) => item.id === id);
  if (!workspace) throw new Error('工作区不存在');
  try { await existingDirectory(workspace.directory); }
  catch { throw new Error('工作目录不可用，原目录可能已移动或删除；历史记录仍然保留'); }
  return workspace;
}

export async function renameWorkspace(tx: Tx, id: string, name: unknown) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('请输入工作区名称');
  if (Array.from(name.trim()).length > 120) throw new Error('工作区名称不能超过 120 个字');
  const workspace = (await tx.doc(WorkspacesDoc)).items.find((item) => item.id === id);
  if (!workspace) throw new Error('工作区不存在');
  workspace.name = name.trim();
}
