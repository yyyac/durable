import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { defineDoc, type ConversationId, type ConversationView, type EntryRecord, type Harness } from '@earendil-works/pi-durable';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ThinkingTiming } from '../src/types.js';

export type ThinkingTimings = { blocks: Record<string, ThinkingTiming> };
const TimingDoc = defineDoc({
  kind: 'workbench.thinking-timing', version: 1, scope: 'conversation', history: 'latest', fork: 'current',
  initial: (): ThinkingTimings => ({ blocks: {} }),
  checkpointWhen: () => true,
});

export function timingKey(taskId: number | undefined, timestamp: number, blockIndex: number) {
  return `${taskId}:${timestamp}:${blockIndex}`;
}

export class ThinkingClock {
  private readonly observing = new Map<ConversationId, Promise<void>>();
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private readonly harness: Harness) {
    harness.subscribeClose(() => { this.closed = true; });
  }
  observe(id: ConversationId) {
    const existing = this.observing.get(id);
    if (existing) return existing;
    const attaching = this.attach(id);
    this.observing.set(id, attaching);
    return attaching;
  }
  private async attach(id: ConversationId) {
    await this.harness.commit(async (tx) => { await tx.doc(TimingDoc, id); }, BACKGROUND_CONTEXT);
    let ready = false;
    let through = 0;
    const waiting: Array<{ view: ConversationView; at: number }> = [];
    const record = (view: ConversationView, at: number, initial = false) => {
      const appended = initial ? [] : view.entries.filter((entry) => entry.id > through);
      through = Math.max(through, view.entries.at(-1)?.id ?? 0);
      // 观察回调运行在提交线上，只排队记录时间，避免回调内读取或提交造成死锁。
      queueMicrotask(() => {
        this.pending = this.pending.then(() => this.record(id, view, appended, at)).catch((error: unknown) => {
          if (!this.closed) console.error('无法保存思考耗时', error);
        });
      });
    };
    const attachingAt = Date.now();
    const observation = await this.harness.observeConversation(id, {
      advance: (call) => {
        if (call.kind !== 'value') return;
        const at = Date.now();
        if (ready) record(call.value, at);
        else waiting.push({ view: call.value, at });
      },
      end: () => {},
    }, BACKGROUND_CONTEXT);
    record(observation.value, attachingAt, true);
    ready = true;
    for (const { view, at } of waiting) record(view, at);
    waiting.length = 0;
  }
  private async record(id: ConversationId, view: ConversationView, appended: readonly EntryRecord[], at: number) {
    if (this.closed) return;
    const live = view.docs['pi.live'] as { run?: { taskId: number }; generation?: { message?: AssistantMessage } } | undefined;
    const message = live?.generation?.message;
    const visible = message?.content.flatMap((block, index) => block.type === 'thinking' && block.thinking && !block.redacted ? [{ key: timingKey(live?.run?.taskId, message.timestamp, index), active: index === message.content.length - 1 }] : []) ?? [];
    await this.harness.commit(async (tx) => {
      const timings = await tx.doc(TimingDoc, id);
      for (const block of visible) {
        timings.blocks[block.key] ??= { startedAt: at };
        if (!block.active) timings.blocks[block.key].endedAt ??= at;
      }
      for (const entry of appended) for (const message of entry.model ?? []) {
        if (message.role !== 'assistant') continue;
        message.content.forEach((block, index) => {
          if (block.type !== 'thinking' || !block.thinking || block.redacted) return;
          const key = timingKey(entry.byTaskId, message.timestamp, index);
          timings.blocks[key] ??= { startedAt: at, endedAt: at };
        });
      }
      const activeKey = visible.find((block) => block.active)?.key;
      for (const [key, timing] of Object.entries(timings.blocks)) {
        if (key !== activeKey) timing.endedAt ??= at;
      }
    }, BACKGROUND_CONTEXT);
  }
  async read(id: ConversationId) {
    await this.pending;
    return await this.harness.snapshot(TimingDoc, id, BACKGROUND_CONTEXT) ?? { blocks: {} };
  }
}
