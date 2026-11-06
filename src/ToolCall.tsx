import { useEffect, useId, useState } from 'react';
import { Check, ChevronRight, FileText, LoaderCircle, Square, X } from 'lucide-react';
import type { ToolCallState } from './types';
import styles from './ToolCall.module.css';

const labels = { pending: '等待中', running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止', awaiting: '待确认', retrying: '重试中', stopping: '停止中' };
export function ToolCall({ tool, conversationId }: { tool: ToolCallState; conversationId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (tool.status === 'awaiting') setExpanded(true); }, [tool.status]);
  async function decide(action: 'retry' | 'stop') {
    if (!tool.recovery || !conversationId || acting) return;
    setActing(true); setError('');
    try {
      const response = await fetch(`/api/conversations/${conversationId}/tools/${tool.recovery.key}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt: tool.recovery.attempt }) });
      if (!response.ok) throw new Error((await response.json()).error);
    } catch (error) { setError((error as Error).message); }
    finally { setActing(false); }
  }
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
    {tool.status === 'awaiting' && <div className={styles.confirmation}><p>写入可能已经发生。确认仅重试这一次调用，停止不会撤销已产生的改动。</p><button type="button" disabled={acting} onClick={() => { void decide('retry'); }}>确认重试</button><button type="button" disabled={acting} onClick={() => { void decide('stop'); }}>停止本轮</button></div>}
    {error && <p role="alert" className={styles.failed}>{error}</p>}
  </section>;
}
