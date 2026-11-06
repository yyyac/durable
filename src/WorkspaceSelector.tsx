import { useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { Folder, FolderPlus, ChevronDown, Check, X } from 'lucide-react';
import type { Workspace } from './types';
import styles from './Workspaces.module.css';
import notice from './LocalToolsNotice.module.css';

export function WorkspaceSelector({ workspaces, workspaceId, defaultDirectory, disabled, onChoose, onAdd }: {
  workspaces: Workspace[]; workspaceId?: string; defaultDirectory?: string; disabled: boolean;
  onChoose: (workspaceId?: string) => Promise<unknown>;
  onAdd: (path: string) => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  const workspace = workspaces.find((item) => item.id === workspaceId);
  async function selectFolder() {
    if (choosing) return;
    setChoosing(true); setError('');
    try {
      const response = await fetch('/api/directories/select', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.path !== null) { setPath(result.path); setTrusted(false); setAdding(true); }
    } catch (error) {
      setPath(''); setTrusted(false); setError((error as Error).message); setAdding(true);
    } finally { setChoosing(false); }
  }
  return <Dialog.Root open={adding} onOpenChange={setAdding}>
    <div className={styles.selector}><Menu.Root>
      <Menu.Trigger aria-label="选择工作目录" disabled={disabled || choosing} className={styles.chip} title={workspace?.directory ?? defaultDirectory}><Folder size={14} /><span>{choosing ? '正在选择文件夹…' : workspace?.name ?? '默认工作目录'}</span><ChevronDown size={12} /></Menu.Trigger>
      <Menu.Portal><Menu.Content className={styles.panel} align="start" sideOffset={4}>
        <Menu.Label className={styles.caption}>工作目录</Menu.Label>
        {[{ id: undefined, name: '默认工作目录', directory: defaultDirectory ?? '为每个普通会话提供独立目录' }, ...workspaces].map((item) => <Menu.Item key={item.id ?? 'default'} className={styles.option} data-selected={item.id === workspaceId} title={item.directory} onSelect={() => { if (item.id !== workspaceId) void onChoose(item.id).catch(() => {}); }}>
          <Folder size={15} /><span className={styles.info}><span className={styles.name}>{item.name}</span><span className={styles.path}>{item.directory}</span></span>{item.id === workspaceId && <Check size={14} />}
        </Menu.Item>)}
        <Menu.Separator className={styles.divider} />
        <Menu.Item className={styles.action} onSelect={() => { void selectFolder(); }}><FolderPlus size={16} />选择文件夹…</Menu.Item>
        <Menu.Item className={styles.action} onSelect={() => { setPath(''); setTrusted(false); setError(''); setAdding(true); }}><FolderPlus size={16} />填写文件夹路径…</Menu.Item>
      </Menu.Content></Menu.Portal>
    </Menu.Root></div>
    <Dialog.Portal><Dialog.Overlay className={notice.overlay} /><Dialog.Content className={notice.dialog}>
      <Dialog.Title>添加工作区</Dialog.Title><Dialog.Description>选择已有本机目录，围绕其中的文件开展工作。</Dialog.Description>
      <form onSubmit={async (event) => {
        event.preventDefault(); if (!trusted || saving) return; setSaving(true); setError('');
        try { await onAdd(path); setAdding(false); }
        catch (error) { setError((error as Error).message); }
        finally { setSaving(false); }
      }}>
        <label className={styles.field}>文件夹绝对路径<input value={path} onChange={(event) => setPath(event.target.value)} required autoFocus /></label>
        <p>本机工具使用后端进程所拥有的用户权限，可读取、创建、修改本机文件并执行 PowerShell 命令。已有文件必须先在当前会话读取；读取后内容变化会拒绝覆盖或编辑，新建时同名文件不会被直接覆盖。命令内部的文件变化不享有文件工具的冲突检测。正常调用直接执行，中断的写入、编辑和所有命令须逐次确认后重试；停止保留已产生的改动和输出，不会撤销。工作目录仅是相对路径的起点，并非目录沙箱，工具也可能访问目录之外的文件。</p>
        <label className={styles.consent}><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />我已了解并信任此工作区的本机工具访问</label>
        {error && <p role="alert">{error}</p>}
        <div className={notice.actions}><Dialog.Close asChild><button type="button" disabled={saving}>取消</button></Dialog.Close><button className={notice.confirm} type="submit" disabled={saving || !trusted}>添加并开始会话</button></div>
      </form>
      <Dialog.Close className={notice.close} aria-label="关闭添加工作区" disabled={saving}><X size={18} /></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
