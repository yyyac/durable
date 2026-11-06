import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Folder, MessageCirclePlus, Plus } from 'lucide-react';
import type { ConversationSummary, Workspace } from './types';
import { WorkspaceMenu } from './WorkspaceMenu';
import { ConversationMenu } from './ConversationMenu';
import { ConversationSearch } from './ConversationSearch';
import { BrandLogo } from './BrandLogo';
import styles from './App.module.css';
import management from './ConversationManagement.module.css';
import workspaceStyles from './Workspaces.module.css';

export function Sidebar({ conversations, workspaces, selectedId, onSelect, onCreate, onCreateWorkspace, onRenameWorkspace, onRename, onArchive, creating, children }: {
  conversations: ConversationSummary[];
  workspaces: Workspace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateWorkspace: (id: string) => void;
  onRenameWorkspace: (id: string, name: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  creating: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const selectedWorkspace = conversations.find((item) => item.id === selectedId)?.workspaceId;
  useEffect(() => { if (selectedWorkspace) setCollapsed((previous) => { const next = new Set(previous); next.delete(selectedWorkspace); return next; }); }, [selectedId, selectedWorkspace]);
  const rows = (workspaceId?: string) => conversations.filter((conversation) => !conversation.archived && conversation.workspaceId === workspaceId).map((conversation) => <div key={conversation.id} className={management.row} aria-current={conversation.id === selectedId ? 'page' : undefined}><button title={conversation.title} className={`${conversation.id === selectedId ? styles.selected : styles.conversation} ${conversation.awaitingConfirmation ? styles.awaitingConversation : ''}`} aria-current={conversation.id === selectedId ? 'page' : undefined} onClick={() => onSelect(conversation.id)}>{conversation.title}</button>{conversation.awaitingConfirmation && <span role="status" aria-label="待确认" title="需要确认中断的工具调用" className={styles.pendingBadge}>待确认</span>}<ConversationMenu conversation={conversation} onRename={onRename} onArchive={onArchive} /></div>);
  return <aside className={styles.sidebar}>
    <h1><BrandLogo className={styles.logo} />个人 Agent 工作台</h1>
    <button className={styles.newConversation} onClick={onCreate} disabled={creating}>
      <MessageCirclePlus size={16} /><span>新建会话</span>
    </button>
    <ConversationSearch conversations={conversations} onSelect={onSelect} />
    <p className={styles.sectionLabel}>会话</p>
    <nav className={styles.conversations} aria-label="会话列表">
      {workspaces.map((workspace) => <section key={workspace.id} aria-label={`${workspace.name}工作区`}>
        <div className={`${management.row} ${workspaceStyles.group}`}>
          <button className={workspaceStyles.groupTitle} title={workspace.directory} aria-label={`${collapsed.has(workspace.id) ? '展开' : '折叠'}${workspace.name}工作区`} aria-expanded={!collapsed.has(workspace.id)} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(workspace.id)) next.delete(workspace.id); else next.add(workspace.id); return next; })}><Folder size={15} /><span>{workspace.name}</span><ChevronDown size={12} className={collapsed.has(workspace.id) ? workspaceStyles.closed : ''} /></button>
          <button className={workspaceStyles.groupCreate} aria-label={`在${workspace.name}中新建会话`} disabled={creating} onClick={() => onCreateWorkspace(workspace.id)}><Plus size={14} /></button>
          <WorkspaceMenu workspace={workspace} onRename={onRenameWorkspace} />
        </div>
        {!collapsed.has(workspace.id) && <div className={workspaceStyles.sessions}>{rows(workspace.id)}</div>}
      </section>)}
      {rows()}
    </nav>
    {children}
  </aside>;
}
