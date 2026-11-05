import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Settings, X, Plus, Trash2, Server } from 'lucide-react';
import type { ConfiguredModel, ModelService, ModelSettings } from './types';
import styles from './App.module.css';
import formStyles from './SettingsDialog.module.css';

type DraftService = ModelService & { apiKey: string };
const newModel = (): ConfiguredModel => ({ id: crypto.randomUUID(), modelId: '', name: '', supportsThinking: false });
const newService = (): DraftService => ({ id: crypto.randomUUID(), name: '模型服务', protocol: 'openai-completions', baseUrl: '', apiKey: '', apiKeyMasked: '', models: [newModel()] });

export function SettingsDialog({ settings, onSaved }: { settings: ModelSettings | null; onSaved: (settings: ModelSettings | null) => void }) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<DraftService[]>([]);
  const [activeId, setActiveId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const active = services.find((service) => service.id === activeId);
  function changeOpen(value: boolean) {
    if (value) {
      const drafts = settings?.services.length ? settings.services.map((service) => ({ ...service, models: service.models.map((model) => ({ ...model })), apiKey: '' })) : [newService()];
      setServices(drafts); setActiveId(drafts[0].id); setError('');
    }
    setOpen(value);
  }
  function update(change: Partial<DraftService>) { setServices((current) => current.map((service) => service.id === activeId ? { ...service, ...change } : service)); }
  function updateModel(id: string, change: Partial<ConfiguredModel>) { if (active) update({ models: active.models.map((model) => model.id === id ? { ...model, ...change } : model) }); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ services, selectedModel: settings?.selectedModel }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved(result); setServices([]); setOpen(false);
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button className={styles.settingsTrigger} aria-label="打开设置"><Settings size={18} />设置</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={formStyles.dialog}>
        <nav className={formStyles.navigation} aria-label="模型服务">
          <Dialog.Title>模型设置</Dialog.Title>
          <p className={formStyles.section}><Server size={15} />模型服务</p>
          <div className={formStyles.serviceList}>{services.map((service) => <button key={service.id} type="button" className={service.id === activeId ? formStyles.active : ''} onClick={() => setActiveId(service.id)}>{service.name || '新模型服务'}</button>)}</div>
          <button type="button" className={formStyles.addService} onClick={() => { const service = newService(); setServices([...services, service]); setActiveId(service.id); }}><Plus size={16} />添加模型服务</button>
        </nav>
        <form className={formStyles.form} onSubmit={save}>
          <div className={formStyles.scroll}>
            <Dialog.Description>管理模型服务及其模型，配置保存在本机。</Dialog.Description>
            {active ? <>
              <div className={formStyles.titleRow}><h3>{active.name || '添加模型服务'}</h3><button type="button" aria-label="移除模型服务" onClick={() => { const next = services.filter((service) => service.id !== activeId); setServices(next); setActiveId(next[0]?.id ?? ''); }}><Trash2 size={16} /></button></div>
              <label>服务名称<input value={active.name} onChange={(event) => update({ name: event.target.value })} placeholder="我的模型服务" required /></label>
              <label>接口协议<select aria-label="接口协议" value={active.protocol} onChange={(event) => update({ protocol: event.target.value as ModelService['protocol'] })}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
              <label>接口地址<input type="url" value={active.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" required /></label>
              <label>API Key<input type="password" autoComplete="new-password" value={active.apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder={active.apiKeyMasked ? '留空保留已保存的密钥' : '输入 API Key'} required={!active.apiKeyMasked} /></label>
              {active.apiKeyMasked && <p>已保存密钥：{active.apiKeyMasked}</p>}
              <div className={formStyles.titleRow}><h3>模型</h3><button type="button" onClick={() => update({ models: [...active.models, newModel()] })}><Plus size={15} />添加模型</button></div>
              {active.models.map((model, index) => { const suffix = index ? ` ${index + 1}` : ''; return <div key={model.id} className={formStyles.model}>
                <div className={formStyles.modelFields}><label>模型 ID{suffix}<input value={model.modelId} onChange={(event) => updateModel(model.id, { modelId: event.target.value })} required /></label><label>模型名称{suffix}<input value={model.name} onChange={(event) => updateModel(model.id, { name: event.target.value })} required /></label><button type="button" aria-label={`移除模型${suffix}`} onClick={() => update({ models: active.models.filter((item) => item.id !== model.id) })}><Trash2 size={15} /></button></div>
                <label className={formStyles.checkbox}><input type="checkbox" checked={model.supportsThinking} onChange={(event) => updateModel(model.id, { supportsThinking: event.target.checked })} />支持思考内容{suffix}</label>
              </div>; })}
            </> : <p>尚未配置模型服务，可添加后开始对话。</p>}
            {error && <p role="alert" className={styles.error}>{error}</p>}
          </div>
          <footer className={formStyles.footer}><span>API Key 以明文保存在本机，保存后仅显示脱敏值。</span><button type="submit" className={styles.primary} disabled={saving}>{saving ? '保存中…' : '保存配置'}</button></footer>
        </form>
        <Dialog.Close asChild><button className={styles.close} aria-label="关闭设置"><X size={18} /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
