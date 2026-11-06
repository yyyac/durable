import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ShieldCheck, X } from 'lucide-react';
import styles from './LocalToolsNotice.module.css';

export function LocalToolsNotice({ directory }: { directory?: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void fetch('/api/local-tools').then(async (response) => { if (!response.ok) throw new Error('无法读取本机工具状态'); setEnabled((await response.json()).enabled); }).catch((error: Error) => setError(error.message)); }, []);
  if (enabled) return null;
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button type="button" className={styles.trigger} disabled={enabled === null}><ShieldCheck size={14} />启用本机工具</button></Dialog.Trigger>
    {error && !open && <span role="alert">{error}</span>}
    <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.dialog}>
      <Dialog.Title>启用本机工具</Dialog.Title>
      <Dialog.Description>确认后，模型可以读取本机文件；后续普通会话会复用本次选择。</Dialog.Description>
      <p>当前默认工作目录</p><p className={styles.path}>{directory}</p>
      <p>本机工具使用后端进程所拥有的用户权限。工作目录仅是相对路径的起点，并非目录沙箱，工具也可能访问目录之外的文件。</p>
      <p>目前提供文件读取。未确认时仍可继续纯聊天。</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}><Dialog.Close asChild><button type="button">继续纯聊天</button></Dialog.Close><button type="button" className={styles.confirm} disabled={saving} onClick={async () => {
        setSaving(true); setError('');
        try {
          const response = await fetch('/api/local-tools/enable', { method: 'POST' });
          if (!response.ok) throw new Error('无法启用本机工具，请重试');
          setEnabled(true); setOpen(false);
        } catch (error) { setError((error as Error).message); }
        finally { setSaving(false); }
      }}>确认启用</button></div>
      <Dialog.Close className={styles.close} aria-label="关闭本机工具说明"><X size={18} /></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
