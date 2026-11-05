import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, X } from 'lucide-react';
import type { ConversationSummary } from './types';
import styles from './ConversationManagement.module.css';

export function ConversationSearch({ conversations, onSelect }: { conversations: ConversationSummary[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const resultsRef = useRef<HTMLDivElement>(null);
  function changeOpen(value: boolean) { if (value) setQuery(''); setOpen(value); }
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setQuery(''); setOpen(true); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const matches = conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function move(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...(resultsRef.current?.querySelectorAll('button') ?? [])];
    const index = buttons.indexOf(event.currentTarget);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button className={styles.searchTrigger} aria-label="搜索"><Search size={16} /><span>搜索</span><kbd>Ctrl K</kbd></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.searchDialog}>
      <Dialog.Title>搜索会话</Dialog.Title><Dialog.Description>按会话名称查找，包含已归档的记录。</Dialog.Description>
      <input className={styles.searchInput} aria-label="搜索会话" placeholder="搜索会话…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); resultsRef.current?.querySelector('button')?.focus(); } }} />
      <div className={styles.searchResults} ref={resultsRef}>{matches.length ? matches.map((conversation) => <button key={conversation.id} onKeyDown={move} onClick={() => { onSelect(conversation.id); setOpen(false); }}><span>{conversation.title}</span>{conversation.archived && <span className={styles.archived}> 已归档</span>}</button>) : <p>没有找到匹配的会话</p>}</div>
      <footer className={styles.searchFooter}>↑ ↓ 选择 · Enter 打开 · Esc 关闭</footer>
      <Dialog.Close asChild><button className={styles.close} aria-label="关闭搜索"><X size={18} /></button></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
