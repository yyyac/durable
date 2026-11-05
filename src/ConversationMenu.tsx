import { useRef, useState, type FormEvent } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { Archive, MoreHorizontal, Pencil, X } from 'lucide-react';
import type { ConversationSummary } from './types';
import styles from './ConversationManagement.module.css';

export function ConversationMenu({ conversation, onRename, onArchive }: { conversation: ConversationSummary; onRename: (id: string, title: string) => Promise<void>; onArchive: (id: string) => Promise<void> }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onRename(conversation.id, title); setRenaming(false); }
    catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open={renaming} onOpenChange={setRenaming}>
    <Menu.Root>
      <Menu.Trigger ref={trigger} className={styles.menuTrigger} aria-label={`${conversation.title}的会话菜单`}><MoreHorizontal size={16} /></Menu.Trigger>
      <Menu.Portal><Menu.Content className={styles.menu} align="start" sideOffset={4} onCloseAutoFocus={(event) => { if (renaming) event.preventDefault(); }}>
        <Menu.Item className={styles.menuItem} onSelect={() => { setTitle(conversation.title); setError(''); setRenaming(true); }}><Pencil size={15} />重命名</Menu.Item>
        <Menu.Item className={styles.menuItem} onSelect={() => { void onArchive(conversation.id).catch((error: Error) => setError(error.message)); }}><Archive size={15} />归档</Menu.Item>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
    {error && !renaming && <span role="alert" className={styles.error}>{error}</span>}
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.renameDialog} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
        <Dialog.Title>重命名会话</Dialog.Title><Dialog.Description>为这段交流设置容易识别的名称。</Dialog.Description>
        <form onSubmit={save}><label>会话名称<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <div className={styles.actions}><Dialog.Close asChild><button type="button">取消</button></Dialog.Close><button type="submit" disabled={saving}>{saving ? '保存中…' : '保存名称'}</button></div>
        </form>
        <Dialog.Close asChild><button className={styles.close} aria-label="关闭重命名"><X size={18} /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
