import { defineDoc, type DocumentReader, type EnvTarget } from '@earendil-works/pi-durable';
import { createReadTool } from '@earendil-works/pi-durable/tools';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import type { Context } from '@earendil-works/chord/context';
import { ConversationsDoc } from './conversations.js';
import { inspectDirectory } from './directories.js';

export const LocalToolsDoc = defineDoc({
  kind: 'workbench.local-tools', version: 1, scope: 'session',
  initial: (): { enabled: boolean } => ({ enabled: false }), checkpointWhen: () => true,
});

export async function localToolsEnabled(reader: DocumentReader, context: Context) {
  return (await reader.snapshot(LocalToolsDoc, context))?.enabled === true;
}

export async function localEnvironment(target: EnvTarget, context: Context) {
  if (!await localToolsEnabled(target.read, context)) return undefined;
  const index = await target.read.snapshot(ConversationsDoc, context);
  const item = index?.items.find((item) => item.id === String(target.conversationId));
  if (!item?.defaultDirectory) throw new Error('会话没有工作目录');
  const directory = await inspectDirectory(item.defaultDirectory);
  if (!directory.available) throw new Error('工作目录不可用，原目录可能已移动或删除；历史记录仍然保留');
  return new NodeExecutionEnv({ cwd: directory.path });
}

const read = createReadTool();
export const readTool = {
  ...read,
  replay: 'safe' as const,
  execute: (async (args, api, context) => {
    if (!await localToolsEnabled(api, context)) throw new Error('尚未启用本机工具');
    if (!api.env) throw new Error('工作目录不可用，无法读取文件');
    const cwd = await api.memo('working-directory', api.env.cwd, context);
    if (cwd !== api.env.cwd) throw new Error('工作目录已变更，请重新发起读取');
    const result = await read.execute(args, api, context);
    return { ...result, details: { ...result.details, cwd } };
  }) satisfies typeof read.execute,
};
