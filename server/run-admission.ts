import type { Context } from '@earendil-works/chord/context';
import { LiveDoc, type ConversationId, type Cursor, type Harness, type TaskId, type Tx } from '@earendil-works/pi-durable';

export const MAX_ACTIVE_RUNS = 10;
export const CAPACITY_ENTRY_KIND = 'workbench.run-capacity';
export const RECOVERY_CAPACITY_MESSAGE = '恢复时超过同时运行上限（10 个会话），已停止本轮；已有输出仍保留，请稍后手动重试。';

export class RunCapacityReached extends Error {
  constructor() { super(`工作台最多同时运行 ${MAX_ACTIVE_RUNS} 个会话，请等待完成或停止其他会话后再试`); }
}

export async function activeRuns(tx: Tx) {
  const runs: Array<{ conversationId: ConversationId; taskId: TaskId }> = [];
  let cursor: Cursor | undefined;
  do {
    const page = await tx.scanConversations({}, 100, cursor);
    for (const conversation of page.items) {
      const { run } = await tx.doc(LiveDoc, conversation.id);
      if (run) runs.push({ conversationId: conversation.id, taskId: run.taskId });
    }
    cursor = page.next;
  } while (cursor);
  return runs;
}

export async function requireRunCapacity(tx: Tx) {
  if ((await activeRuns(tx)).length >= MAX_ACTIVE_RUNS) throw new RunCapacityReached();
}

export async function limitRecoveredRuns(harness: Harness, context: Context) {
  const overflow = await harness.commit(async (tx) => {
    const overflow = (await activeRuns(tx)).slice(MAX_ACTIVE_RUNS);
    for (const { conversationId, taskId } of overflow) {
      await tx.appendEntry(conversationId, { kind: CAPACITY_ENTRY_KIND, data: { taskId } });
    }
    return overflow;
  }, context);
  // 调度启动前先持久化全部中止标记，超额运行不会先恢复再等待空位。
  for (const { taskId } of overflow) await harness.abortTask(taskId, context);
}

export async function stoppedForCapacity(tx: Tx, conversationId: ConversationId, taskId: TaskId | undefined) {
  if (taskId === undefined) return false;
  let cursor: Cursor | undefined;
  do {
    const entries = await tx.scanEntries({ conversationId, order: 'descending' }, 100, cursor);
    if (entries.items.some((entry) => entry.kind === CAPACITY_ENTRY_KIND && (entry.data as { taskId: number }).taskId === taskId)) return true;
    cursor = entries.next;
  } while (cursor);
  return false;
}
