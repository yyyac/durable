import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Settings, X, Plus, Trash2, Server, Eye, EyeOff, Check, ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react';
import type { ConfiguredModel, ModelService, ModelSettings } from './types';
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from './types';
import styles from './App.module.css';
import formStyles from './SettingsDialog.module.css';

type DraftModel = Omit<ConfiguredModel, 'contextWindow' | 'maxTokens'> & { contextWindow: number | ''; maxTokens: number | '' };
type DraftService = Omit<ModelService, 'models'> & { apiKey: string; models: DraftModel[] };
const newModel = (): DraftModel => ({ id: crypto.randomUUID(), modelId: '', name: '', contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS, supportsThinking: false });
const newService = (): DraftService => ({ id: crypto.randomUUID(), name: '模型服务', protocol: 'openai-completions', baseUrl: '', apiKey: '', hasApiKey: false, models: [newModel()] });
const protocols: Array<{ value: ModelService['protocol']; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

export function SettingsDialog({ settings, onSaved }: { settings: ModelSettings | null; onSaved: (settings: ModelSettings | null) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<DraftService | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const services = settings?.services ?? [];
  const editing = services.some((service) => service.id === active?.id);
  function changeOpen(value: boolean) {
    if (saving) return;
    setActive(null); setError(''); setShowApiKey(false); setOpen(value);
  }
  function returnToList() { setActive(null); setError(''); setShowApiKey(false); }
  function editService(service: ModelService) { setActive({ ...service, apiKey: '', models: service.models.map((model) => ({ ...model })) }); setError(''); setShowApiKey(false); }
  function update(change: Partial<DraftService>) { setActive((current) => current ? { ...current, ...change } : null); }
  function updateModel(id: string, change: Partial<DraftModel>) { if (active) update({ models: active.models.map((model) => model.id === id ? { ...model, ...change } : model) }); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    await persist(editing ? services.map((service) => service.id === active.id ? active : service) : [...services, active]);
  }
  async function persist(nextServices: Array<ModelService | DraftService>) {
    setError(''); setSaving(true);
    try {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ services: nextServices, selectedModel: settings?.selectedModel }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved(result); returnToList();
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button className={styles.settingsTrigger} aria-label="打开设置"><Settings size={18} />设置</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={formStyles.overlay} />
      <Dialog.Content className={formStyles.dialog}>
        <nav className={formStyles.navigation} aria-label="设置分类">
          <Dialog.Title>模型设置</Dialog.Title>
          <button type="button" className={formStyles.section} aria-current="page" disabled={saving} onClick={returnToList}><Server size={16} />模型供应商</button>
        </nav>
        <Dialog.Description className={formStyles.visuallyHidden}>管理自定义供应商，配置接口、密钥及模型上下文和最大输出大小。</Dialog.Description>
        {active ? <form className={formStyles.form} onSubmit={save}>
          <header className={formStyles.header}>
            <button type="button" className={formStyles.back} aria-label="返回供应商列表" disabled={saving} onClick={returnToList}><ArrowLeft size={17} /></button>
            <span className={formStyles.serviceIcon}><Server size={18} /></span>
            <h3>{editing ? active.name || '编辑供应商' : '添加供应商'}</h3>
          </header>
          <div className={formStyles.scroll}>
            <fieldset className={formStyles.fields} disabled={saving}>
                <label className={formStyles.field}>服务名称<span className={formStyles.required} aria-hidden="true"> *</span><input aria-label="服务名称" value={active.name} onChange={(event) => update({ name: event.target.value })} placeholder="我的模型服务" required /></label>
                <div className={formStyles.field}>
                  <span>接口协议<span className={formStyles.required} aria-hidden="true"> *</span></span>
                  <Menu.Root>
                    <Menu.Trigger type="button" aria-label="接口协议" className={formStyles.protocolTrigger} disabled={saving}><span>{protocols.find((protocol) => protocol.value === active.protocol)?.label}</span><ChevronDown size={16} /></Menu.Trigger>
                    <Menu.Portal><Menu.Content className={formStyles.protocolMenu} align="start" sideOffset={6} collisionPadding={12}>
                      <Menu.RadioGroup value={active.protocol} onValueChange={(value) => update({ protocol: value as ModelService['protocol'] })}>
                        {protocols.map((protocol) => <Menu.RadioItem key={protocol.value} value={protocol.value} className={formStyles.protocolOption}><span>{protocol.label}</span><Menu.ItemIndicator className={formStyles.protocolCheck}><Check size={15} /></Menu.ItemIndicator></Menu.RadioItem>)}
                      </Menu.RadioGroup>
                    </Menu.Content></Menu.Portal>
                  </Menu.Root>
                </div>
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
            </fieldset>
            {error && <p role="alert" className={styles.error}>{error}</p>}
          </div>
          <footer className={formStyles.footer}>
            {editing && <button type="button" className={formStyles.deleteService} aria-label="移除模型服务" disabled={saving} onClick={() => { void persist(services.filter((service) => service.id !== active.id)); }}>删除供应商</button>}
            <div className={formStyles.actions}><button type="button" disabled={saving} onClick={returnToList}>取消</button><button type="submit" className={formStyles.save} disabled={saving}>{saving ? '保存中…' : '保存配置'}</button></div>
          </footer>
        </form> : <section className={formStyles.providers} aria-label="供应商管理">
          <header className={`${formStyles.header} ${formStyles.listHeader}`}><h3>模型供应商</h3><button type="button" className={formStyles.addService} onClick={() => setActive(newService())}><Plus size={16} />添加供应商</button></header>
          <div className={formStyles.scroll}>
            <section aria-label="自定义供应商">
              <h4 className={formStyles.listTitle}>自定义供应商</h4>
              {services.length ? <div className={formStyles.providerList}>{services.map((service) => <button key={service.id} type="button" className={formStyles.providerCard} aria-label={service.name} onClick={() => editService(service)}>
                <span className={formStyles.serviceIcon}><Server size={18} /></span>
                <span className={formStyles.providerInfo}><span className={formStyles.providerName}>{service.name}</span><span className={formStyles.protocolBadge}>{protocols.find((protocol) => protocol.value === service.protocol)?.label}</span></span>
                <span className={formStyles.modelCount}>{service.models.length} 个模型</span><ChevronRight size={16} aria-hidden="true" />
              </button>)}</div> : <div className={formStyles.empty}><Server size={28} /><p>尚未添加供应商</p><span>添加供应商后，即可配置接口和模型。</span></div>}
            </section>
          </div>
        </section>}
        <Dialog.Close asChild><button className={formStyles.close} aria-label="关闭设置" disabled={saving}><X size={18} /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
