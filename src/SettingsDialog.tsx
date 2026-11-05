import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Settings, X } from 'lucide-react';
import type { ModelSettings } from './types';
import styles from './App.module.css';

export function SettingsDialog({ settings, onSaved }: { settings: ModelSettings | null; onSaved: (settings: ModelSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    setSaving(true);
    try {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved(result);
      form.reset();
      setOpen(false);
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button className={styles.settingsTrigger} aria-label="打开设置"><Settings size={18} />设置</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.dialog}>
        <Dialog.Title>模型设置</Dialog.Title>
        <Dialog.Description>配置自己的模型服务，在本机保存连接信息。</Dialog.Description>
        <form onSubmit={save}>
          <label>接口地址<input name="baseUrl" type="url" defaultValue={settings?.baseUrl} placeholder="https://api.example.com/v1" required /></label>
          <label>API Key<input name="apiKey" type="password" autoComplete="new-password" placeholder={settings ? '留空保留已保存的密钥' : '输入 API Key'} required={!settings} /></label>
          {settings && <p>已保存密钥：{settings.apiKeyMasked}</p>}
          <div className={styles.formColumns}>
            <label>模型 ID<input name="modelId" defaultValue={settings?.modelId} placeholder="服务提供的模型 ID" required /></label>
            <label>模型名称<input name="name" defaultValue={settings?.name} placeholder="用于显示的名称" required /></label>
          </div>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <p>API Key 以明文保存在本机，保存后仅显示脱敏值。</p>
          <button type="submit" className={styles.primary} disabled={saving}>{saving ? '保存中…' : '保存配置'}</button>
        </form>
        <Dialog.Close asChild><button className={styles.close} aria-label="关闭设置"><X size={18} /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
