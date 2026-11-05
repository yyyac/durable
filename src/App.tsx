import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';
import { MessageContent } from './MessageContent';
import { useFollowingScroll } from './useFollowingScroll';
import { Sidebar } from './Sidebar';
import { useConversations } from './useConversations';
import { useConversation } from './useConversation';
import type { ModelSettings } from './types';
import styles from './App.module.css';

export function App() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const { conversations, selectedId, select, create, creating, refresh, error: listError } = useConversations();
  const { state, connection } = useConversation(selectedId);
  const currentId = useRef(selectedId);
  currentId.current = selectedId;
  useEffect(() => { void fetch('/api/settings').then((response) => response.json()).then(setSettings); }, []);
  useEffect(() => {
    setInput('');
    setError('');
    setSubmitting(false);
    setStopping(false);
  }, [selectedId]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!state || !settings || state.busy || submitting || !input.trim()) return;
    setSubmitting(true);
    setError('');
    const sendingId = state.id;
    try {
      const response = await fetch(`/api/conversations/${state.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: input }) });
      if (!response.ok) throw new Error((await response.json()).error);
      if (currentId.current === sendingId) setInput('');
      await refresh();
    } catch (error) { if (currentId.current === sendingId) setError((error as Error).message); }
    finally { if (currentId.current === sendingId) setSubmitting(false); }
  }
  async function stop() {
    if (!state?.busy || stopping) return;
    const stoppingId = state.id;
    setStopping(true);
    setError('');
    try {
      const response = await fetch(`/api/conversations/${stoppingId}/stop`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).error);
    } catch (error) { if (currentId.current === stoppingId) setError((error as Error).message); }
    finally { if (currentId.current === stoppingId) setStopping(false); }
  }
  const messages = [...(state?.messages ?? []), ...(state?.generation ? [state.generation] : [])];
  const { scrollRef, onScroll } = useFollowingScroll(state?.id, messages);
  return <div className={styles.workbench}>
    <Sidebar conversations={conversations} selectedId={selectedId} onSelect={select} onCreate={() => { void create(); }} creating={creating || !selectedId}>
      <SettingsDialog settings={settings} onSaved={setSettings} />
    </Sidebar>
    <main className={styles.main}>
      <header className={styles.header}>{conversations.find((conversation) => conversation.id === selectedId)?.title ?? '新会话'}</header>
      <div className={styles.messages} ref={scrollRef} onScroll={onScroll}>
        {messages.length ? <div className={styles.transcript}>{messages.map((message) => <article key={`${state?.id}:${message.role}:${message.timestamp}`} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
          <MessageContent message={message} streaming={message === state?.generation} />
        </article>)}</div> : <div className={styles.empty}><h2>开始一次对话</h2>{settings ? <p>{settings.name}</p> : <><p>尚未配置模型</p><p>请先在设置中添加模型服务。</p></>}</div>}
      </div>
      <div className={styles.composerArea}>
        {connection === 'reconnecting' && <p role="status" className={styles.connection}>连接已断开，正在重连…</p>}
        {state?.failure?.reason === 'aborted' && messages.at(-1)?.termination !== 'stopped' && <p role="status" className={styles.connection}>已停止</p>}
        {(error || listError) && <p role="alert" className={styles.error}>{error || listError}</p>}
        <form className={styles.composer} onSubmit={send}>
          <textarea aria-label="输入消息" placeholder="输入消息…" value={input} onChange={(event) => setInput(event.target.value)} disabled={!settings || !state || state.busy || submitting} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
          }} />
          <div className={styles.composerActions}><span>{state?.busy ? '工作中…' : settings?.name ?? '请先配置模型'}</span>{state?.busy ? <button type="button" aria-label="停止生成" className={styles.send} disabled={stopping} onClick={() => { void stop(); }}><Square size={12} fill="currentColor" /></button> : <button type="submit" aria-label="发送消息" className={styles.send} disabled={!settings || !state || submitting}><ArrowUp size={18} /></button>}</div>
        </form>
        <p className={styles.inputHint}>Enter 发送，Shift + Enter 换行</p>
      </div>
    </main>
  </div>;
}
