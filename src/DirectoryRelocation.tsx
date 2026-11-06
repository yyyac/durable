import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FolderSearch, X } from 'lucide-react';
import type { DirectoryRelocation as Preview } from './types';
import notice from './LocalToolsNotice.module.css';
import styles from './Workspaces.module.css';

export function DirectoryRelocation({ conversationId, path, onSaved }: { conversationId: string; path: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <Dialog.Root open={open} onOpenChange={(open) => { if (!saving) setOpen(open); }}>
    <Dialog.Trigger asChild><button className={notice.trigger} onClick={() => { setTarget(''); setPreview(null); setError(''); }}><FolderSearch size={14} />重新定位工作目录</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className={notice.overlay} /><Dialog.Content className={notice.dialog}>
      <Dialog.Title>重新定位工作目录</Dialog.Title><Dialog.Description>先结束相关会话的运行中和待确认任务，再确认原目录与新目录。历史和已产生的文件改动仍然保留。</Dialog.Description>
      <p>原目录</p><p className={notice.path}>{preview?.previousPath ?? path}</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); if (saving) return; setSaving(true); setError('');
        try {
          const response = await fetch(`/api/conversations/${conversationId}/directory/${preview ? 'relocate' : 'preview'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preview ? { path: preview.path, expectedPath: preview.previousPath, expectedVersion: preview.version, confirmed: true } : { path: target }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (preview) { await onSaved(); setOpen(false); }
          else setPreview(result);
        } catch (error) { setError((error as Error).message); setPreview(null); }
        finally { setSaving(false); }
      }}>
        <label className={styles.field}>新目录绝对路径<input required value={target} onChange={(event) => { setTarget(event.target.value); setPreview(null); }} /></label>
        {preview && <><p>新目录（实际路径）</p><p className={notice.path}>{preview.path}</p><p>确认后，该目录用于后续操作。已有消息和工具参数中的原路径不会改写。</p></>}
        {error && <p role="alert">{error}</p>}
        <div className={notice.actions}><Dialog.Close asChild><button type="button" disabled={saving}>取消</button></Dialog.Close><button className={notice.confirm} type="submit" disabled={saving}>{preview ? '确认重新定位' : '检查目录'}</button></div>
      </form><Dialog.Close className={notice.close} aria-label="关闭重新定位" disabled={saving}><X size={18} /></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
