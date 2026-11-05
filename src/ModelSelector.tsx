import { useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { selectedModel, type ContextUsage, type ModelSettings } from './types';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import styles from './ModelSelector.module.css';

export function ModelSelector({ settings, contextUsage, onSaved }: { settings: ModelSettings; contextUsage: ContextUsage | null; onSaved: (settings: ModelSettings) => void }) {
  const selected = selectedModel(settings);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function select(value: string) {
    const [serviceId, modelId] = JSON.parse(value) as [string, string];
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/settings/selection', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId, modelId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved(result);
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <div className={styles.selector}>
    {selected && <ContextUsageIndicator usage={contextUsage} contextWindow={selected.model.contextWindow} provider={selected.service.id} modelId={selected.model.modelId} />}
    <Menu.Root>
      <Menu.Trigger className={styles.trigger} aria-label="选择模型" disabled={saving}><span className={styles.modelName}>{selected?.model.name ?? '选择模型'}</span><ChevronDown size={14} /></Menu.Trigger>
      <Menu.Portal><Menu.Content className={styles.menu} side="top" align="end" sideOffset={8}>
        <Menu.RadioGroup value={JSON.stringify([selected?.service.id, selected?.model.id])} onValueChange={(value) => { void select(value); }}>
          {settings.services.filter((service) => service.models.length).map((service) => <Menu.Group key={service.id}>
            <Menu.Label className={styles.label}>{service.name}</Menu.Label>
            {service.models.map((model) => <Menu.RadioItem key={model.id} value={JSON.stringify([service.id, model.id])} className={styles.item}><Menu.ItemIndicator className={styles.indicator}><Check size={14} /></Menu.ItemIndicator>{model.name}</Menu.RadioItem>)}
          </Menu.Group>)}
        </Menu.RadioGroup>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </div>;
}
