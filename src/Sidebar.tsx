import type { ReactNode } from 'react';
import { MessageCirclePlus } from 'lucide-react';
import type { ConversationSummary } from './types';
import { ConversationMenu } from './ConversationMenu';
import { ConversationSearch } from './ConversationSearch';
import styles from './App.module.css';
import management from './ConversationManagement.module.css';

export function Sidebar({ conversations, selectedId, onSelect, onCreate, onRename, onArchive, creating, children }: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  creating: boolean;
  children: ReactNode;
}) {
  return <aside className={styles.sidebar}>
    <h1><span className={styles.logo}>Ⅱ</span>个人 Agent 工作台</h1>
    <button className={styles.newConversation} onClick={onCreate} disabled={creating}>
      <MessageCirclePlus size={16} /><span>新建会话</span>
    </button>
    <ConversationSearch conversations={conversations} onSelect={onSelect} />
    <p className={styles.sectionLabel}>会话</p>
    <nav className={styles.conversations} aria-label="会话列表">
      {conversations.filter((conversation) => !conversation.archived).map((conversation) => <div key={conversation.id} className={management.row} aria-current={conversation.id === selectedId ? 'page' : undefined}><button title={conversation.title} className={conversation.id === selectedId ? styles.selected : styles.conversation} aria-current={conversation.id === selectedId ? 'page' : undefined} onClick={() => onSelect(conversation.id)}>{conversation.title}</button><ConversationMenu conversation={conversation} onRename={onRename} onArchive={onArchive} /></div>)}
    </nav>
    {children}
  </aside>;
}
