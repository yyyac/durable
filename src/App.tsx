import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Square, FolderOpen } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';
import { ModelSelector } from './ModelSelector';
import { MessageContent } from './MessageContent';
import { LocalToolsNotice } from './LocalToolsNotice';
import { useFollowingScroll } from './useFollowingScroll';
import { Sidebar } from './Sidebar';
import { BrandLogo } from './BrandLogo';
import { useConversations } from './useConversations';
import { useConversation } from './useConversation';
import { canRetryReply, selectedModel, type ModelSettings } from './types';
import styles from './App.module.css';

export function App() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const selected = selectedModel(settings);
  const { conversations, selectedId, select, create, creating, refresh, rename, archive, error: listError } = useConversations();
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
    if (!state || !selected || state.busy || submitting || creating || !input.trim()) return;
    setSubmitting(true);
    setError('');
    const sendingId = state.id;
    try {
      const response = await fetch(`/api/conversations/${state.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: input, modelSelection: settings?.selectedModel }) });
      if (!response.ok) throw new Error((await response.json()).error);
      if (currentId.current === sendingId) setInput('');
      await refresh();
    } catch (error) { if (currentId.current === sendingId) setError((error as Error).message); }
    finally { if (currentId.current === sendingId) setSubmitting(false); }
  }
  async function retry() {
    if (!state || !selected || state.busy || submitting || creating || !canRetryReply(state.failure)) return;
    const retryingId = state.id;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/conversations/${retryingId}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelSelection: settings?.selectedModel }) });
      if (!response.ok) throw new Error((await response.json()).error);
    } catch (error) { if (currentId.current === retryingId) setError((error as Error).message); }
    finally { if (currentId.current === retryingId) setSubmitting(false); }
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
  async function openDirectory() {
    if (!state) return;
    const openingId = state.id;
    setError('');
    try {
      const response = await fetch(`/api/conversations/${openingId}/directory/open`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).error);
    } catch (error) { if (currentId.current === openingId) setError((error as Error).message); }
  }
  const visibleGeneration = state?.generation?.content.some((block) => block.type === 'tool' || (block.type === 'text' ? block.text : block.thinking).trim()) ? state.generation : null;
  const messages = [...(state?.messages ?? []), ...(visibleGeneration ? [visibleGeneration] : [])];
  const runningTool = messages.some((message) => message.content.some((block) => block.type === 'tool' && (block.tool.status === 'pending' || block.tool.status === 'running')));
  const requesting = (submitting || state?.busy) && !visibleGeneration && !runningTool;
  const empty = !messages.length && !requesting;
  const directoryButton = state?.directory && <button type="button" aria-label="打开工作目录" title={state.directory.path} className={styles.directory} onClick={() => { void openDirectory(); }}><FolderOpen size={14} /><span>{state.directory.path}</span></button>;
  const { scrollRef, onScroll } = useFollowingScroll(state?.id, messages);
  return <div className={styles.workbench}>
    <Sidebar conversations={conversations} selectedId={selectedId} onSelect={select} onCreate={() => { void create(); }} onRename={rename} onArchive={archive} creating={creating || !selectedId}>
      <SettingsDialog settings={settings} onSaved={setSettings} />
    </Sidebar>
    <main className={`${styles.main} ${empty ? styles.mainEmpty : ''}`}>
      {!empty && <header className={styles.header}><h2 aria-label="会话标题">{conversations.find((conversation) => conversation.id === selectedId)?.title ?? '新会话'}</h2>{directoryButton}</header>}
      <div className={styles.messages} ref={scrollRef} onScroll={onScroll}>
        {messages.length || requesting ? <div className={styles.transcript}>{messages.map((message) => <article key={`${state?.id}:${message.role}:${message.timestamp}`} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
          <MessageContent message={message} streaming={message === state?.generation} showFailureDetail={state?.busy || !canRetryReply(state?.failure) || message !== state?.messages.at(-1)} />
        </article>)}{requesting && <div role="status" aria-label="正在请求模型" className={styles.requesting}><BrandLogo size={22} className={styles.requestLogo} /><span>请求中…</span></div>}</div> : <div className={styles.empty}><h2><BrandLogo size={46} />Agent 工作台</h2>{!selected && <><p>尚未配置模型</p><p>请先在设置中添加模型服务。</p></>}</div>}
        {!state?.busy && canRetryReply(state?.failure) && <div role="alert" className={styles.failureNotice}>
          <p>回复失败：{state?.failure?.detail || '模型未能完成回复，请检查模型服务后重试。'}</p>
          <button type="button" onClick={() => { void retry(); }} disabled={submitting || !selected}>重试回复</button>
        </div>}
      </div>
      <div className={styles.composerArea}>
        {empty && directoryButton}
        {state?.directory && !state.directory.available && <p role="status" className={styles.connection}><strong>工作目录不可用</strong>，原目录可能已移动或删除。历史记录仍然保留。</p>}
        {connection === 'reconnecting' && <p role="status" className={styles.connection}>连接已断开，正在重连…</p>}
        {state?.failure?.reason === 'aborted' && messages.at(-1)?.termination !== 'stopped' && <p role="status" className={styles.connection}>已停止</p>}
        {(error || listError) && <p role="alert" className={styles.error}>{error || listError}</p>}
        <form className={styles.composer} onSubmit={send}>
          <div className={styles.composerInput}>
            <textarea aria-label="输入消息" placeholder="输入消息…" rows={1} value={input} onChange={(event) => setInput(event.target.value)} disabled={!selected || !state || state.busy || submitting || creating} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} />
          </div>
          <div className={styles.composerActions}><span>{selected ? <LocalToolsNotice directory={state?.directory?.path} /> : '请先配置模型'}</span>{settings && selected && <ModelSelector settings={settings} contextUsage={state?.contextUsage ?? null} onSaved={setSettings} />}{state?.busy ? <button type="button" aria-label="停止生成" className={styles.send} disabled={stopping} onClick={() => { void stop(); }}><Square size={12} fill="currentColor" /></button> : <button type="submit" aria-label="发送消息" className={styles.send} disabled={!selected || !state || submitting || creating}><ArrowUp size={18} /></button>}</div>
        </form>
      </div>
    </main>
  </div>;
}
