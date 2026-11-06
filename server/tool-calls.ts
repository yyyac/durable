import { defineDoc, type ConversationId, type JsonObject, type TaskId, type Tx } from '@earendil-works/pi-durable';

export type RecoveryCall = {
  key: string; sourceId: string; nativeTaskId: number; assistantEntry: number; runId: number;
  callId: string; name: string; args: JsonObject; cwd: string;
  status: 'executing' | 'awaiting' | 'retrying' | 'stopping' | 'done' | 'stopped';
  attempt: number; retryTaskId?: number; output: string; result?: JsonObject;
  precondition?: JsonObject;
};
export const ToolCallsDoc = defineDoc({
  kind: 'workbench.tool-calls', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: (): { items: RecoveryCall[] } => ({ items: [] }), checkpointWhen: () => true,
});
export function unfinished(call: Pick<RecoveryCall, 'status'>) {
  return !['done', 'stopped'].includes(call.status);
}
export async function hasUnfinishedCalls(tx: Tx, conversationId: ConversationId) {
  return (await tx.doc(ToolCallsDoc, conversationId)).items.some(unfinished);
}
export async function recoveryActiveTask(tx: Tx, conversationId: ConversationId, runId?: TaskId) {
  const calls = (await tx.doc(ToolCallsDoc, conversationId)).items;
  const retry = calls.find((call) => call.status === 'retrying' || call.status === 'stopping');
  if (retry) return (retry.retryTaskId ?? retry.nativeTaskId) as TaskId;
  if (calls.some((call) => call.status === 'awaiting' || (call.status === 'stopped' && call.runId === runId))) return undefined;
  return runId;
}
