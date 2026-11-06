import type { Context } from '@earendil-works/chord/context';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { defineTask, LiveDoc, ProviderDoc, type ConversationId, type Cursor, type DocumentObserver, type DocumentReader, type EntryId, type Harness, type JsonObject, type TaskId, type ToolExecutionResult, type ToolRegistration, type Tx } from '@earendil-works/pi-durable';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import type { Api, AssistantMessage, Message, Model } from '@earendil-works/pi-ai';
import type { Models } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { ToolCallsDoc, unfinished, type RecoveryCall } from './tool-calls.js';
import { ConversationsDoc } from './conversations.js';
import { WorkspacesDoc, requireWorkspace } from './workspaces.js';
import { conversationDirectory, inspectDirectory } from './directories.js';
import { requireRunCapacity } from './run-admission.js';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';

export type RecoveryOperation = (args: JsonObject, env: ExecutionEnv, output: (text: string) => Promise<void>, context: Context) => Promise<ToolExecutionResult>;
export const recoveryOperations = new Map<string, RecoveryOperation>();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function withDirectory(result: ToolExecutionResult, cwd: string, output: string): ToolExecutionResult {
  const details = result.details && typeof result.details === 'object' && !Array.isArray(result.details) ? result.details : {};
  return { ...result, output: result.output ?? (output ? [{ type: 'text', text: output }] : []), details: { ...details, cwd } };
}

function blocks(call: RecoveryCall, runId: number | undefined) {
  return unfinished(call) || (call.status === 'stopped' && call.runId === runId);
}
export async function waitForToolBarrier(reader: DocumentReader & DocumentObserver, conversationId: ConversationId, runId: number | undefined, context: Context) {
  context.abortSignal?.throwIfAborted();
  const calls = await reader.snapshot(ToolCallsDoc, conversationId, context);
  context.abortSignal?.throwIfAborted();
  if (!calls?.items.some((call) => blocks(call, runId))) return;
  const watch = await reader.watchDoc(ToolCallsDoc, conversationId, context);
  if (!watch) throw new Error('无法读取工具恢复状态');
  try {
    if (!watch.value.items.some((call) => blocks(call, runId))) return;
    await new Promise<void>((resolve, reject) => {
      const signal = context.abortSignal;
      const finish = (error?: unknown) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      const abort = () => finish(signal?.reason ?? new Error('已停止'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      watch.start(async (call) => { if (call.kind === 'value' && !call.value.items.some((item) => blocks(item, runId))) finish(); });
      void watch.closed.then(() => finish(new Error('工具恢复状态观察已结束')), finish);
    });
  } finally { await watch.stop(); }
}

export function recoverableTool<T extends ToolRegistration>(tool: T, operation: RecoveryOperation): T {
  recoveryOperations.set(tool.name, operation);
  return {
    ...tool, replay: 'unsafe', executionMode: 'sequential',
    async execute(args: JsonObject, api, context) {
      const task = await api.getTask(api.taskId, context);
      await waitForToolBarrier(api, api.conversationId, task?.owner, context);
      if (!api.env) throw new Error('工作目录不可用，无法执行本机工具');
      const key = String(api.taskId);
      await api.commit(async (tx) => {
        const native = await tx.task(api.taskId);
        const input = native?.input as { assistant?: number } | undefined;
        if (input?.assistant === undefined || native?.owner === undefined) throw new Error('工具调用缺少持久身份');
        const entry = await tx.entry(input.assistant as EntryId);
        const messageIndex = entry?.model?.findIndex((message) => message.role === 'assistant' && message.content.some((block) => block.type === 'toolCall' && block.id === api.callId)) ?? -1;
        if (messageIndex < 0) throw new Error('工具调用来源不存在');
        const calls = await tx.doc(ToolCallsDoc, api.conversationId);
        calls.items.push({ key, sourceId: `${input.assistant}:${messageIndex}:${api.callId}`, nativeTaskId: api.taskId, assistantEntry: input.assistant, runId: native.owner, callId: api.callId, name: tool.name, args: clone(args), cwd: api.env!.cwd, status: 'executing', attempt: 0, output: '' });
      }, context);
      let output = '';
      let result: ToolExecutionResult;
      try {
        result = await operation(args, api.env, async (text) => {
          output = (output + text).slice(-50_000);
          api.output(text);
          await api.commit(async (tx) => {
            const call = (await tx.doc(ToolCallsDoc, api.conversationId)).items.find((item) => item.key === key);
            if (call?.status !== 'executing' || call.attempt !== 0) throw new Error('本轮工具调用已结束');
            call.output = output;
          }, context);
        }, context);
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        result = { isError: true, output: output ? [{ type: 'text', text: output }] : [], diagnostics: [{ severity: 'error', code: 'tool_error', message: (error as Error).message }] };
      }
      result = withDirectory(result, api.env.cwd, output);
      await api.commit(async (tx) => {
        const call = (await tx.doc(ToolCallsDoc, api.conversationId)).items.find((item) => item.key === key);
        if (call?.status !== 'executing' || call.attempt !== 0) throw new Error('本轮工具调用已结束');
        call.status = 'done'; call.result = clone(result) as JsonObject;
      }, context);
      return result;
    },
  } as T;
}

async function validateOriginalDirectory(tx: Tx, conversationId: ConversationId, call: RecoveryCall) {
  const item = (await tx.doc(ConversationsDoc)).items.find((item) => item.id === String(conversationId));
  if (item?.workspaceId) await requireWorkspace(tx, item.workspaceId);
  const workspaces = await tx.doc(WorkspacesDoc);
  const cwd = conversationDirectory(item, workspaces.items);
  if (cwd !== call.cwd) throw new Error('原工作目录关联已变更，不能重试旧调用');
  if (!(await inspectDirectory(cwd)).available) throw new Error('原工作目录不可用，不能重试');
  if (call.name === 'write' && typeof call.args.path === 'string') {
    let exists = true;
    try { await lstat(resolve(cwd, call.args.path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false; else throw error; }
    if (exists) throw new Error('目标文件已存在，不能重试创建；请保留原文件并处理后重试，或停止本轮');
  }
}

export const ToolRetryTask = defineTask<{ key: string; attempt: number }, { phase: 'start' } | { phase: 'uncertain' }, { done: boolean }, {}>({
  name: 'workbench.tool-retry', version: 1, initial: () => ({ phase: 'start' }),
  phases: {
    start: async (task, runtime, context) => {
      let original: RecoveryCall | undefined;
      await runtime.commit(async (tx) => {
        const call = (await tx.doc(ToolCallsDoc, runtime.conversationId)).items.find((item) => item.key === task.input.key);
        if (!call || call.retryTaskId !== runtime.taskId || call.attempt !== task.input.attempt || call.status !== 'retrying') return { status: 'terminal', outcome: { status: 'aborted' } };
        original = clone(call);
        return { status: 'running', checkpoint: { phase: 'uncertain' } };
      }, context);
      if (!original) return;
      let output = original.output;
      let result: ToolExecutionResult;
      try {
        const env = await runtime.env(context);
        if (!env || env.cwd !== original.cwd) throw new Error('原工作目录已失效或变更，不能重试');
        const operation = recoveryOperations.get(original.name);
        if (!operation) throw new Error('原工具当前不可用，不能重试');
        result = await operation(original.args, env, async (text) => {
          output = (output + text).slice(-50_000);
          await runtime.commit(async (tx) => {
            const call = (await tx.doc(ToolCallsDoc, runtime.conversationId)).items.find((item) => item.key === task.input.key);
            if (!call || call.retryTaskId !== runtime.taskId || call.attempt !== task.input.attempt || call.status !== 'retrying') throw new Error('这次重试已失效');
            call.output = output;
            return undefined;
          }, context);
        }, context);
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        result = { isError: true, output: output ? [{ type: 'text', text: output }] : [], diagnostics: [{ severity: 'error', code: 'tool_error', message: (error as Error).message }] };
      }
      result = withDirectory(result, original.cwd, output);
      const conversation = await runtime.conversation(runtime.conversationId, context);
      await runtime.commit(async (tx) => {
        const call = (await tx.doc(ToolCallsDoc, runtime.conversationId)).items.find((item) => item.key === task.input.key);
        if (!call || call.retryTaskId !== runtime.taskId || call.attempt !== task.input.attempt || call.status !== 'retrying') return { status: 'terminal', outcome: { status: 'aborted' } };
        const live = await tx.doc(LiveDoc, runtime.conversationId);
        if (!live.run) {
          if (!conversation) throw new Error('原会话不存在');
          await conversation.submit(tx, { type: 'continue' });
        }
        call.status = 'done'; call.result = clone(result) as JsonObject;
        return { status: 'terminal', outcome: { status: 'completed', result: { done: true } } };
      }, context);
    },
    uncertain: async (task, runtime, context) => {
      await runtime.commit(async (tx) => {
        const call = (await tx.doc(ToolCallsDoc, runtime.conversationId)).items.find((item) => item.key === task.input.key);
        if (call?.retryTaskId === runtime.taskId && call.attempt === task.input.attempt && call.status === 'retrying') call.status = 'awaiting';
        return { status: 'terminal', outcome: { status: 'completed', result: { done: false } } };
      }, context);
    },
  },
  abort: async (task, runtime, context) => {
    await runtime.commit(async (tx) => {
      const call = (await tx.doc(ToolCallsDoc, runtime.conversationId)).items.find((item) => item.key === task.input.key);
      if (call?.retryTaskId === runtime.taskId && call.attempt === task.input.attempt && ['retrying', 'stopping'].includes(call.status)) call.status = 'stopped';
      return { status: 'terminal', outcome: { status: 'aborted' } };
    }, context);
  },
});

export async function confirmToolCall(harness: Harness, conversationId: ConversationId, key: string, attempt: number, context: Context) {
  const result = await harness.commit(async (tx) => {
    const call = (await tx.doc(ToolCallsDoc, conversationId)).items.find((item) => item.key === key);
    if (!call) throw new Error('待确认调用不存在');
    if (['retrying', 'done'].includes(call.status) && call.attempt === attempt + 1) return { taskId: call.retryTaskId, accepted: false };
    if (call.status !== 'awaiting' || call.attempt !== attempt) throw new Error('这次确认已失效，请刷新后重新处理');
    await requireRunCapacity(tx);
    await validateOriginalDirectory(tx, conversationId, call);
    call.status = 'retrying'; call.attempt++;
    call.retryTaskId = await tx.createTask(ToolRetryTask, { key, attempt: call.attempt }, { conversationId, ownership: { kind: 'conversation' } });
    return { taskId: call.retryTaskId, accepted: true };
  }, context);
  harness.resume();
  return result;
}

export async function reconcileToolCalls(harness: Harness, context: Context) {
  const abort = await harness.commit(async (tx) => {
    const abort: number[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanConversations({}, 100, cursor);
      for (const conversation of page.items) {
        const calls = await tx.doc(ToolCallsDoc, conversation.id);
        for (const call of calls.items) {
          if (call.status === 'executing' || call.status === 'retrying') call.status = 'awaiting';
          if (call.status === 'stopping') call.status = 'stopped';
          if (call.status === 'stopped') abort.push(call.runId, ...(call.retryTaskId === undefined ? [] : [call.retryTaskId]));
        }
      }
      cursor = page.next;
    } while (cursor);
    return [...new Set(abort)];
  }, context);
  for (const id of abort) await harness.abortTask(id as TaskId, context);
}

export async function stopToolCalls(harness: Harness, conversationId: ConversationId, context: Context, expected?: { key: string; attempt: number }) {
  const stopping = await harness.commit(async (tx) => {
    const live = await tx.doc(LiveDoc, conversationId);
    const calls = await tx.doc(ToolCallsDoc, conversationId);
    if (expected && !calls.items.some((call) => call.key === expected.key && call.attempt === expected.attempt && call.status === 'awaiting')) throw new Error('这次待确认调用已失效，请刷新后重试');
    const taskIds: number[] = live.run ? [live.run.taskId] : [];
    const attempts: Array<{ key: string; attempt: number }> = [];
    for (const call of calls.items) if (unfinished(call)) {
      attempts.push({ key: call.key, attempt: call.attempt });
      if (call.retryTaskId !== undefined) taskIds.push(call.retryTaskId);
      call.status = call.status === 'awaiting' ? 'stopped' : 'stopping';
    }
    if (live.run) await tx.appendEntry(conversationId, { kind: 'workbench.stop', data: { taskId: live.run.taskId, timestamp: live.generation?.message?.timestamp ?? null } });
    return { taskIds: [...new Set(taskIds)], attempts };
  }, context);
  for (const id of stopping.taskIds) await harness.abortTask(id as TaskId, context);
  for (const id of stopping.taskIds) await harness.waitForTask(id as TaskId, context);
  await harness.commit(async (tx) => {
    const calls = await tx.doc(ToolCallsDoc, conversationId);
    for (const stopped of stopping.attempts) {
      const call = calls.items.find((item) => item.key === stopped.key);
      if (call?.attempt === stopped.attempt && call.status === 'stopping') call.status = 'stopped';
    }
  }, context);
}

async function providerOwner(harness: Harness, sessionId: string | undefined) {
  if (!sessionId) throw new Error('模型请求缺少会话身份');
  return harness.commit(async (tx) => {
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanConversations({}, 100, cursor);
      for (const conversation of page.items) if ((await tx.doc(ProviderDoc, conversation.id)).sessionId === sessionId) {
        const runId = (await tx.doc(LiveDoc, conversation.id)).run?.taskId;
        if (runId === undefined) throw new Error('模型请求所属运行已结束');
        return { conversationId: conversation.id, runId };
      }
      cursor = page.next;
    } while (cursor);
    throw new Error('模型请求会话身份无效');
  }, BACKGROUND_CONTEXT);
}

async function recoveredMessages(harness: Harness, conversationId: ConversationId, messages: Message[]) {
  const calls = (await harness.snapshot(ToolCallsDoc, conversationId, BACKGROUND_CONTEXT))?.items ?? [];
  let repaired = messages;
  for (const call of calls) {
    if (call.status !== 'done' || !call.result) continue;
    const native = await harness.getTask(call.nativeTaskId as TaskId, BACKGROUND_CONTEXT);
    if (call.attempt === 0 && native?.state.outcome?.status === 'completed') continue;
    const entryId = (native?.state.outcome?.result as { entryId?: number } | undefined)?.entryId;
    if (!entryId) continue;
    const entry = await harness.commit((tx) => tx.entry(entryId as EntryId), BACKGROUND_CONTEXT);
    const original = entry?.model?.find((message) => message.role === 'toolResult');
    if (!original) continue;
    const result = call.result as ToolExecutionResult;
    const signature = JSON.stringify(original);
    repaired = repaired.map((message) => message.role === 'toolResult' && JSON.stringify(message) === signature ? { ...message, content: [...(result.output ?? []), ...(result.diagnostics?.length ? [{ type: 'text' as const, text: result.diagnostics.map((item) => item.message).join('\n') }] : [])], isError: result.isError ?? false, details: result.details } : message);
  }
  return repaired;
}

function streamFailure(model: Model<Api>, error: unknown, aborted: boolean): AssistantMessage {
  return { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: aborted ? 'aborted' : 'error', errorMessage: String(error), timestamp: Date.now() };
}
export function recoveryModels(models: Models, getHarness: () => Harness): Models {
  const stream = models.streamSimple.bind(models);
  models.streamSimple = (model, transcript, options) => {
    const events = createAssistantMessageEventStream();
    void (async () => {
      try {
        const harness = getHarness();
        const owner = await providerOwner(harness, options?.sessionId);
        const context = { ...BACKGROUND_CONTEXT, abortSignal: options?.signal };
        await waitForToolBarrier(harness, owner.conversationId, owner.runId, context);
        const messages = await recoveredMessages(harness, owner.conversationId, transcript.messages);
        const transport = options?.fetch ?? globalThis.fetch;
        const inner = stream(model, { ...transcript, messages }, { ...options, fetch: async (...args) => { await waitForToolBarrier(harness, owner.conversationId, owner.runId, context); return transport(...args); } });
        for await (const event of inner) events.push(event);
        events.end(await inner.result());
      } catch (error) {
        const failed = streamFailure(model, error, options?.signal?.aborted === true);
        events.push({ type: 'error', reason: failed.stopReason as 'aborted' | 'error', error: failed }); events.end(failed);
      }
    })();
    return events;
  };
  const deferred = models.fetchDeferred.bind(models);
  models.fetchDeferred = async (model, handle, options) => {
    const harness = getHarness();
    const owner = await harness.commit(async (tx) => {
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanTasks({ kind: 'pi.generation' }, 100, cursor);
        for (const task of page.items) {
          const checkpoint = 'checkpoint' in task.state ? task.state.checkpoint as { phase?: string; handle?: unknown; model?: { provider: string; modelId: string } } : undefined;
          if (checkpoint?.phase === 'poll' && checkpoint.model?.provider === model.provider && checkpoint.model.modelId === model.id && JSON.stringify(checkpoint.handle) === JSON.stringify(handle)) return { conversationId: task.conversationId, runId: task.id };
        }
        cursor = page.next;
      } while (cursor);
      throw new Error('无法识别延迟模型请求的会话，已拒绝执行');
    }, BACKGROUND_CONTEXT);
    const context = { ...BACKGROUND_CONTEXT, abortSignal: options?.signal };
    await waitForToolBarrier(harness, owner.conversationId, owner.runId, context);
    const transport = options?.fetch ?? globalThis.fetch;
    return deferred(model, handle, { ...options, fetch: async (...args) => { await waitForToolBarrier(harness, owner.conversationId, owner.runId, context); return transport(...args); } });
  };
  return models;
}
