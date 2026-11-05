import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Settings, X, Plus, Trash2, Server, Eye, EyeOff } from 'lucide-react';
import type { ConfiguredModel, ModelService, ModelSettings } from './types';
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from './types';
import styles from './App.module.css';
import formStyles from './SettingsDialog.module.css';

type DraftModel = Omit<ConfiguredModel, 'contextWindow' | 'maxTokens'> & { contextWindow: number | ''; maxTokens: number | '' };
type DraftService = Omit<ModelService, 'models'> & { apiKey: string; models: DraftModel[] };
const newModel = (): DraftModel => ({ id: crypto.randomUUID(), modelId: '', name: '', contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS, supportsThinking: false });
const newService = (): DraftService => ({ id: crypto.randomUUID(), name: '模型服务', protocol: 'openai-completions', baseUrl: '', apiKey: '', hasApiKey: false, models: [newModel()] });

export function SettingsDialog({ settings, onSaved }: { settings: ModelSettings | null; onSaved: (settings: ModelSettings | null) => void }) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<DraftService[]>([]);
  const [activeId, setActiveId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const active = services.find((service) => service.id === activeId);
  function changeOpen(value: boolean) {
    if (saving) return;
    if (value) {
      const drafts = settings?.services.length ? settings.services.map((service) => ({ ...service, models: service.models.map((model) => ({ ...model })), apiKey: '' })) : [newService()];
      setServices(drafts); setActiveId(drafts[0].id); setError('');
    } else {
      setServices([]);
    }
    setShowApiKey(false); setOpen(value);
  }
  function selectService(id: string) { setActiveId(id); setShowApiKey(false); }
  function update(change: Partial<DraftService>) { setServices((current) => current.map((service) => service.id === activeId ? { ...service, ...change } : service)); }
  function updateModel(id: string, change: Partial<DraftModel>) { if (active) update({ models: active.models.map((model) => model.id === id ? { ...model, ...change } : model) }); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ services, selectedModel: settings?.selectedModel }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved(result); setServices([]); setShowApiKey(false); setOpen(false);
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button className={styles.settingsTrigger} aria-label="打开设置"><Settings size={18} />设置</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={formStyles.overlay} />
      <Dialog.Content className={formStyles.dialog}>
        <nav className={formStyles.navigation} aria-label="模型服务">
          <Dialog.Title>模型设置</Dialog.Title>
          <p className={formStyles.section}><Server size={16} />模型服务</p>
          <div className={formStyles.serviceList}>{services.map((service) => <button key={service.id} type="button" disabled={saving} aria-current={service.id === activeId ? 'page' : undefined} className={service.id === activeId ? formStyles.active : ''} onClick={() => selectService(service.id)}>{service.name || '新模型服务'}</button>)}</div>
          <button type="button" className={formStyles.addService} disabled={saving} onClick={() => { const service = newService(); setServices([...services, service]); selectService(service.id); }}><Plus size={16} />添加模型服务</button>
        </nav>
        <form className={formStyles.form} onSubmit={save}>
          <header className={formStyles.header}>
            <span className={formStyles.serviceIcon}><Server size={18} /></span>
            <h3>{active?.name || '模型服务'}</h3>
          </header>
          <Dialog.Description className={formStyles.visuallyHidden}>配置模型服务的接口、密钥及模型上下文和最大输出大小。</Dialog.Description>
          <div className={formStyles.scroll}>
            <fieldset className={formStyles.fields} disabled={saving}>
              {active ? <>
                <label className={formStyles.field}>服务名称<span className={formStyles.required} aria-hidden="true"> *</span><input aria-label="服务名称" value={active.name} onChange={(event) => update({ name: event.target.value })} placeholder="我的模型服务" required /></label>
                <label className={formStyles.field}>接口协议<span className={formStyles.required} aria-hidden="true"> *</span><select aria-label="接口协议" value={active.protocol} onChange={(event) => update({ protocol: event.target.value as ModelService['protocol'] })}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
                <label className={formStyles.field}>API Key<span className={formStyles.required} aria-hidden="true"> *</span>
                  <span className={formStyles.keyField}>
                    <input aria-label="API Key" type={showApiKey && active.apiKey ? 'text' : 'password'} autoComplete="new-password" className={active.hasApiKey ? formStyles.savedKey : undefined} value={active.apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder={active.hasApiKey ? '••••••••••••••••' : '输入 API Key'} required={!active.hasApiKey} />
                    <button type="button" aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'} aria-pressed={showApiKey} disabled={!active.apiKey} onClick={() => setShowApiKey(!showApiKey)}>{showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </span>
                </label>
                <label className={formStyles.field}>接口地址<span className={formStyles.required} aria-hidden="true"> *</span><input aria-label="接口地址" type="url" value={active.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" required /></label>
                <section className={formStyles.models} aria-label="模型列表">
                  <div className={formStyles.modelsTitle}><h4>模型</h4><span>{active.models.length} 个模型</span></div>
                  {active.models.length > 0 && <div className={formStyles.modelHead} aria-hidden="true"><span>模型 ID<span className={formStyles.required}> *</span></span><span>上下文<span className={formStyles.required}> *</span></span><span title="maxTokens，单位为 tokens">最大输出<span className={formStyles.required}> *</span></span><span>显示名<span className={formStyles.required}> *</span></span><span /></div>}
                  {active.models.map((model, index) => { const suffix = index ? ` ${index + 1}` : ''; return <div key={model.id} className={formStyles.model}>
                    <div className={formStyles.modelFields}>
                      <label><span className={formStyles.modelLabel}>模型 ID</span><input aria-label={`模型 ID${suffix}`} value={model.modelId} onChange={(event) => updateModel(model.id, { modelId: event.target.value })} placeholder="例如 glm-5.3-flash" required /></label>
                      <label><span className={formStyles.modelLabel}>上下文</span><input aria-label={`上下文${suffix}`} type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" inputMode="numeric" title="上下文大小，单位为 tokens" value={model.contextWindow} onChange={(event) => updateModel(model.id, { contextWindow: Number.isNaN(event.target.valueAsNumber) ? '' : event.target.valueAsNumber })} required /></label>
                      <label><span className={formStyles.modelLabel}>最大输出</span><input aria-label={`最大输出${suffix}`} type="number" min="1" max={model.contextWindow || Number.MAX_SAFE_INTEGER} step="1" inputMode="numeric" title="maxTokens，单位为 tokens，不能超过上下文大小" value={model.maxTokens} onChange={(event) => updateModel(model.id, { maxTokens: Number.isNaN(event.target.valueAsNumber) ? '' : event.target.valueAsNumber })} required /></label>
                      <label><span className={formStyles.modelLabel}>显示名</span><input aria-label={`模型名称${suffix}`} value={model.name} onChange={(event) => updateModel(model.id, { name: event.target.value })} placeholder="模型显示名称" required /></label>
                      <button type="button" className={formStyles.removeModel} aria-label={`移除模型${suffix}`} onClick={() => update({ models: active.models.filter((item) => item.id !== model.id) })}><Trash2 size={15} /></button>
                    </div>
                    <label className={formStyles.checkbox}><input type="checkbox" checked={model.supportsThinking} onChange={(event) => updateModel(model.id, { supportsThinking: event.target.checked })} />支持思考内容{suffix}</label>
                  </div>; })}
                  <button type="button" className={formStyles.addModel} onClick={() => update({ models: [...active.models, newModel()] })}><Plus size={16} />添加模型</button>
                </section>
              </> : <p className={formStyles.empty}>尚未配置模型服务，可添加后开始对话。</p>}
            </fieldset>
            {error && <p role="alert" className={styles.error}>{error}</p>}
          </div>
          <footer className={formStyles.footer}>
            {active && <button type="button" className={formStyles.deleteService} aria-label="移除模型服务" disabled={saving} onClick={() => { const next = services.filter((service) => service.id !== activeId); setServices(next); selectService(next[0]?.id ?? ''); }}>删除模型服务</button>}
            <div className={formStyles.actions}><button type="button" disabled={saving} onClick={() => changeOpen(false)}>取消</button><button type="submit" className={formStyles.save} disabled={saving}>{saving ? '保存中…' : '保存配置'}</button></div>
          </footer>
        </form>
        <Dialog.Close asChild><button className={formStyles.close} aria-label="关闭设置" disabled={saving}><X size={18} /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
