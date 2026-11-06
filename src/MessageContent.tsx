import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Copy, Lightbulb } from 'lucide-react';
import Markdown from 'react-markdown';
import type { ChatMessage, ThinkingTiming } from './types';
import styles from './MessageContent.module.css';
import { ToolCall } from './ToolCall';

function CopyButton({ label, text }: { label: string; text: () => string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return <><button className={styles.copyButton} aria-label={label} title={copied ? '已复制' : label} onClick={async () => {
    try { await navigator.clipboard.writeText(text()); setCopied(true); setError(false); }
    catch { setError(true); }
  }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>{error && <span role="status">无法复制，请手动选择文字</span>}</>;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = useRef<HTMLPreElement>(null);
  return <div className={styles.codeBlock}>
    <div className={styles.codeToolbar}><span>代码</span><CopyButton label="复制代码" text={() => code.current?.textContent ?? ''} /></div>
    <pre ref={code}>{children}</pre>
  </div>;
}

function ThinkingBlock({ text, active, timing }: { text: string; active: boolean; timing?: ThinkingTiming }) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const id = useId();
  useEffect(() => {
    if (!timing || !active || timing.endedAt !== undefined) return;
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [active, timing]);
  const elapsed = timing ? Math.max(0, Math.round(((timing.endedAt ?? now) - timing.startedAt) / 1000)) : null;
  return <section className={styles.thinking}>
    <button className={styles.thinkingToggle} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
      <Lightbulb size={15} /><span>{active ? '思考中…' : '思考过程'}</span>{elapsed !== null && <span>· {elapsed}s</span>}<ChevronRight size={13} className={expanded ? styles.expanded : undefined} />
    </button>
    <div id={id} hidden={!expanded} className={styles.thinkingText}>{text}</div>
  </section>;
}

export function MessageContent({ message, streaming, showReplyFooter, showFailureDetail = true, conversationId }: { message: ChatMessage; streaming: boolean; showReplyFooter: boolean; showFailureDetail?: boolean; conversationId?: string }) {
  const body = message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n\n');
  const failed = message.stopReason === 'error';
  return <>
  <div data-testid={message.role === 'assistant' ? 'assistant-message' : 'user-message'}>
    {message.content.map((block, index) => block.type === 'thinking'
      ? <ThinkingBlock key={index} text={block.thinking} timing={block.timing} active={streaming && index === message.content.length - 1} />
      : block.type === 'tool' ? <ToolCall key={block.tool.id} tool={block.tool} conversationId={conversationId} />
      : message.role === 'assistant' ? <div key={index} className={styles.markdown}><Markdown components={{ pre: CodeBlock }}>{block.text}</Markdown></div> : <div key={index}>{block.text}</div>)}
  </div>
  {(showReplyFooter || message.termination || failed) && <div className={styles.footer}>
    {showReplyFooter && <time>{new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>}
    {message.termination && <span>{message.termination === 'stopped' ? '已停止' : '已中断'}</span>}
    {showReplyFooter && message.role === 'assistant' && body && <CopyButton label="复制正文" text={() => body} />}
    {failed && <span className={styles.failure}>回复失败{showFailureDetail && `：${message.errorMessage || '模型未能完成回复'}`}</span>}
  </div>}
  </>;
}
