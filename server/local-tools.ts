import { defineDoc, type DocumentReader, type EnvTarget } from '@earendil-works/pi-durable';
import { createReadTool } from '@earendil-works/pi-durable/tools';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import type { Context } from '@earendil-works/chord/context';
import { ConversationsDoc } from './conversations.js';
import { inspectDirectory, conversationDirectory } from './directories.js';
import { WorkspacesDoc, checkConversationActive } from './workspaces.js';
import { waitForToolBarrier } from './tool-recovery.js';

export const LocalToolsDoc = defineDoc({
  kind: 'workbench.local-tools', version: 1, scope: 'session',
  initial: (): { enabled: boolean } => ({ enabled: false }), checkpointWhen: () => true,
});

export async function localToolsEnabled(reader: DocumentReader, context: Context, conversationId?: number) {
  if (conversationId !== undefined) {
    const item = (await reader.snapshot(ConversationsDoc, context))?.items.find((item) => item.id === String(conversationId));
    if (item?.workspaceId) return (await reader.snapshot(WorkspacesDoc, context))?.items.some((workspace) => workspace.id === item.workspaceId && !workspace.archived) === true;
  }
  return (await reader.snapshot(LocalToolsDoc, context))?.enabled === true;
}

export async function localEnvironment(target: EnvTarget, context: Context) {
  await checkConversationActive(target.read, target.conversationId, context);
  if (!await localToolsEnabled(target.read, context, target.conversationId)) return undefined;
  const index = await target.read.snapshot(ConversationsDoc, context);
  const item = index?.items.find((item) => item.id === String(target.conversationId));
  const workspaces = await target.read.snapshot(WorkspacesDoc, context);
  const directory = await inspectDirectory(conversationDirectory(item, workspaces?.items ?? []));
  if (!directory.available) throw new Error('工作目录不可用，原目录可能已移动或删除；历史记录仍然保留');
  return new NodeExecutionEnv({ cwd: directory.path });
}

const read = createReadTool();
export const readTool = {
  ...read,
  replay: 'safe' as const,
  execute: (async (args, api, context) => {
    const task = await api.getTask(api.taskId, context);
    await waitForToolBarrier(api, api.conversationId, task?.owner, context);
    if (!await localToolsEnabled(api, context, api.conversationId)) throw new Error('尚未启用本机工具');
    if (!api.env) throw new Error('工作目录不可用，无法读取文件');
    const cwd = await api.memo('working-directory', api.env.cwd, context);
    if (cwd !== api.env.cwd) throw new Error('工作目录已变更，请重新发起读取');
    if (!(await inspectDirectory(cwd)).available) throw new Error('工作目录不可用，无法读取文件');
    const result = await read.execute(args, api, context);
    return { ...result, details: { ...result.details, cwd } };
  }) satisfies typeof read.execute,
};
