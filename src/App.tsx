import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';
import { ModelSelector } from './ModelSelector';
import { useConversation } from './useConversation';
import { selectedModel, type ModelSettings } from './types';
import styles from './App.module.css';

export function App() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const { state, connection } = useConversation(conversationId);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const selected = selectedModel(settings);
  useEffect(() => { void fetch('/api/settings').then((response) => response.json()).then(setSettings); }, []);
  useEffect(() => {
    let active = true;
    void fetch('/api/conversation').then((response) => response.json()).then(({ id }) => {
      if (active) setConversationId(id);
    }).catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!state || !selected || state.busy || submitting || !input.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/conversations/${state.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: input, modelSelection: settings?.selectedModel }) });
      if (!response.ok) throw new Error((await response.json()).error);
      setInput('');
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }
  const messages = [...(state?.messages ?? []), ...(state?.generation ? [state.generation] : [])];
  return <div className={styles.workbench}>
    <aside className={styles.sidebar}>
      <h1><span className={styles.logo}>Ⅱ</span>个人 Agent 工作台</h1>
      <p className={styles.sectionLabel}>会话</p>
      <div className={styles.selected}>新会话</div>
      <SettingsDialog settings={settings} onSaved={setSettings} />
    </aside>
    <main className={styles.main}>
      <header className={styles.header}>新会话</header>
      <div className={styles.messages}>
        {messages.length ? <div className={styles.transcript}>{messages.map((message) => <article key={message.id} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
          <div data-testid={message.role === 'assistant' ? 'assistant-message' : 'user-message'}>{message.content.map((block) => block.type === 'text' ? block.text : '').join('')}</div>
          <time>{new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
        </article>)}</div> : <div className={styles.empty}><h2>开始一次对话</h2>{selected ? <p>{selected.model.name}</p> : <><p>尚未配置模型</p><p>请先在设置中添加模型服务。</p></>}</div>}
      </div>
      <div className={styles.composerArea}>
        {connection === 'reconnecting' && <p role="status" className={styles.connection}>连接已断开，正在重连…</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <form className={styles.composer} onSubmit={send}>
          <textarea aria-label="输入消息" placeholder="输入消息…" value={input} onChange={(event) => setInput(event.target.value)} disabled={!selected || state?.busy || submitting} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
          }} />
          <div className={styles.composerActions}>{settings && selected ? <ModelSelector settings={settings} onSaved={setSettings} /> : <span>请先配置模型</span>}<span>{state?.busy ? '工作中…' : ''}</span><button type="submit" aria-label="发送消息" className={styles.send} disabled={!selected || !state || state.busy || submitting}><ArrowUp size={18} /></button></div>
        </form>
        <p className={styles.inputHint}>Enter 发送，Shift + Enter 换行</p>
      </div>
    </main>
  </div>;
}
