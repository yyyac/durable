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
      <Dialog.Description>确认后，模型可以读取、创建、修改本机文件并执行 PowerShell 命令；后续普通会话会复用本次选择。</Dialog.Description>
      <p>当前默认工作目录</p><p className={styles.path}>{directory}</p>
      <p>本机工具使用后端进程所拥有的用户权限。工作目录仅是相对路径的起点，并非目录沙箱，工具也可能访问目录之外的文件。</p>
      <p>修改已有文件前必须在当前会话成功读取；读取后内容变化会拒绝覆盖或编辑，模型需重新读取。新建时同名文件不会被直接覆盖。命令内部的文件变化不享有文件工具的冲突检测。正常调用直接执行；中断的写入、编辑和所有命令须逐次确认后重试，即使命令看起来只是读取。停止保留已产生的改动和输出，不会撤销。未确认时仍可继续纯聊天。</p>
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
