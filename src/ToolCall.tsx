import { useId, useState } from 'react';
import { Check, ChevronRight, FileText, LoaderCircle, Square, X } from 'lucide-react';
import type { ToolCallState } from './types';
import styles from './ToolCall.module.css';

const labels = { pending: '等待中', running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止' };
export function ToolCall({ tool }: { tool: ToolCallState }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const Icon = tool.status === 'completed' ? Check : tool.status === 'failed' ? X : tool.status === 'stopped' ? Square : LoaderCircle;
  return <section className={styles.tool} data-tool-call-id={tool.id}>
    <button type="button" className={styles.head} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
      <FileText size={18} /><span className={styles.name}>{tool.name}</span><span className={styles.path}>{String(tool.arguments.path ?? '')}</span><span className={`${styles.status} ${tool.status === 'failed' ? styles.failed : ''}`}><Icon size={13} />{labels[tool.status]}</span><ChevronRight size={14} className={expanded ? styles.expanded : ''} />
    </button>
    <div id={id} hidden={!expanded} className={styles.body}>
      {tool.cwd && <div className={styles.directory}>工作目录：{tool.cwd}</div>}
      <pre aria-label="工具参数">{JSON.stringify(tool.arguments, null, 2)}</pre>
      <pre data-testid="tool-output">{tool.output || (tool.status === 'pending' || tool.status === 'running' ? '等待工具输出…' : '无文本输出')}</pre>
    </div>
  </section>;
}
