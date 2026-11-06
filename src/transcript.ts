import type { ChatMessage, ContentBlock, ToolCallState } from './types';

export type ActivityItem = { key: string; block: Exclude<ContentBlock, { type: 'text' }>; active: boolean };
export type TranscriptRow =
  | { type: 'text'; key: string; text: string }
  | { type: 'activity'; key: string; items: ActivityItem[] };

export function transcriptRows(messages: ChatMessage[], generation?: ChatMessage | null) {
  let activity: Extract<TranscriptRow, { type: 'activity' }> | undefined;
  return messages.map((message) => {
    const rows: TranscriptRow[] = [];
    if (message.role === 'user') activity = undefined;
    message.content.forEach((block, index) => {
      const key = `${message.timestamp}:${index}`;
      if (block.type === 'text') {
        if (!block.text.trim()) return;
        rows.push({ type: 'text', key, text: block.text });
        activity = undefined;
      } else {
        // 工具结果和后续思考可能分属不同模型消息，直到下一段正文才结束这一组。
        if (!activity) {
          activity = { type: 'activity', key, items: [] };
          rows.push(activity);
        }
        activity.items.push({ key, block, active: message === generation && index === message.content.length - 1 });
      }
    });
    if (message.role === 'user' || message.termination || message.stopReason === 'error') activity = undefined;
    return rows;
  });
}

export function toolSummary(tools: ToolCallState[]) {
  const phrases: Record<string, (count: number) => string> = {
    powershell: n => `运行了 ${n} 条命令`,
    read: n => `读取文件 ${n} 次`,
    write: n => `写入文件 ${n} 次`,
    edit: n => `编辑文件 ${n} 次`,
  };
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const kind = Object.hasOwn(phrases, tool.name) ? tool.name : 'other';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const summary = [...counts].map(([kind, n]) => phrases[kind]?.(n) ?? `执行了 ${n} 次工具调用`).join(' · ');
  const failures = tools.filter(tool => tool.status === 'failed').length;
  const stopped = tools.filter(tool => tool.status === 'stopped').length;
  const statuses = [failures && `${failures} 失败`, stopped && `${stopped} 已停止`].filter(Boolean);
  return statuses.length ? `${summary}（${statuses.join('，')}）` : summary;
}
