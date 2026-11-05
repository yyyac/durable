import type { ReactNode } from 'react';
import { MessageCirclePlus } from 'lucide-react';
import type { ConversationSummary } from './types';
import styles from './App.module.css';

export function Sidebar({ conversations, selectedId, onSelect, onCreate, creating, children }: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  creating: boolean;
  children: ReactNode;
}) {
  return <aside className={styles.sidebar}>
    <h1><span className={styles.logo}>Ⅱ</span>个人 Agent 工作台</h1>
    <button className={styles.newConversation} onClick={onCreate} disabled={creating}>
      <MessageCirclePlus size={16} /><span>新建会话</span>
    </button>
    <p className={styles.sectionLabel}>会话</p>
    <nav className={styles.conversations} aria-label="会话列表">
      {conversations.map((conversation) => <button key={conversation.id} title={conversation.title} className={conversation.id === selectedId ? styles.selected : styles.conversation} aria-current={conversation.id === selectedId ? 'page' : undefined} onClick={() => onSelect(conversation.id)}>{conversation.title}</button>)}
    </nav>
    {children}
  </aside>;
}
