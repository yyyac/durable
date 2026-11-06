import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ConversationId, Tx } from '@earendil-works/pi-durable';
import { ConversationsDoc } from './conversations.js';
import type { WorkingDirectory } from '../src/types.js';

export async function allocateDefaultDirectory(tx: Tx, id: ConversationId, dataDirectory: string) {
  const index = await tx.doc(ConversationsDoc);
  const item = index.items.find((conversation) => conversation.id === String(id));
  if (!item || item.defaultDirectory) return;
  const path = join(dataDirectory, 'sessions', String(id));
  await mkdir(path, { recursive: true });
  item.defaultDirectory = path;
}

export async function inspectDirectory(path: string): Promise<WorkingDirectory> {
  try { return { path, available: (await stat(path)).isDirectory() }; }
  catch { return { path, available: false }; }
}

export async function openLocalDirectory(path: string) {
  if (process.platform !== 'win32') throw new Error('当前系统不支持打开本机文件夹，请复制目录路径后打开');
  await new Promise<void>((resolve, reject) => {
    const explorer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), [path], { stdio: 'ignore', detached: true });
    explorer.once('error', () => reject(new Error('无法打开本机文件夹，请检查系统权限后重试')));
    explorer.once('spawn', () => { explorer.unref(); resolve(); });
  });
}
