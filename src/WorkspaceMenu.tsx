import { useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { MoreHorizontal, Pencil, X } from 'lucide-react';
import type { Workspace } from './types';
import styles from './ConversationManagement.module.css';

export function WorkspaceMenu({ workspace, onRename }: { workspace: Workspace; onRename: (id: string, name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Menu.Root><Menu.Trigger className={styles.menuTrigger} aria-label={`${workspace.name}的工作区菜单`}><MoreHorizontal size={16} /></Menu.Trigger>
      <Menu.Portal><Menu.Content className={styles.menu} align="start" sideOffset={4} onCloseAutoFocus={(event) => { if (open) event.preventDefault(); }}>
        <Menu.Item className={styles.menuItem} onSelect={() => { setName(workspace.name); setError(''); setOpen(true); }}><Pencil size={15} />重命名</Menu.Item>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
    <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.renameDialog}>
      <Dialog.Title>重命名工作区</Dialog.Title><Dialog.Description>修改显示名称，目录和会话归属保持不变。</Dialog.Description>
      <form onSubmit={async (event) => {
        event.preventDefault(); setSaving(true); setError('');
        try { await onRename(workspace.id, name); setOpen(false); }
        catch (error) { setError((error as Error).message); }
        finally { setSaving(false); }
      }}><label>工作区名称<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}><Dialog.Close asChild><button type="button">取消</button></Dialog.Close><button type="submit" disabled={saving}>保存名称</button></div>
      </form><Dialog.Close className={styles.close} aria-label="关闭工作区重命名"><X size={18} /></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
