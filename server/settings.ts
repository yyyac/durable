import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConfiguredModel, ModelProtocol, ModelSelection, ModelService, ModelSettings } from '../src/types.js';

type StoredService = Omit<ModelService, 'apiKeyMasked'> & { apiKey: string };
export type StoredSettings = Omit<ModelSettings, 'services'> & { services: StoredService[] };

function text(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}
function normalize(input: unknown, previous: StoredSettings | null): StoredSettings {
  if (!input || typeof input !== 'object') throw new Error('模型配置无效');
  const fields = input as Record<string, unknown>;
  const incoming = Array.isArray(fields.services) ? fields.services : [{
    ...fields, id: 'configured', name: '模型服务',
    models: [{ id: 'legacy', modelId: fields.modelId, name: fields.name, supportsThinking: fields.supportsThinking === true || fields.supportsThinking === 'on' }],
  }];
  const services: StoredService[] = incoming.map((item) => {
    const service = item as Record<string, unknown>;
    const id = typeof service.id === 'string' && service.id ? service.id : randomUUID();
    const name = text(service.name, '请填写服务名称');
    const baseUrl = text(service.baseUrl, '请填写接口地址').replace(/\/$/, '');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('接口地址必须使用 HTTP 或 HTTPS');
    const protocol = service.protocol ?? 'openai-completions';
    if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(String(protocol))) throw new Error('模型服务协议无效');
    const apiKey = typeof service.apiKey === 'string' && service.apiKey ? service.apiKey : previous?.services.find((old) => old.id === id)?.apiKey;
    if (!apiKey) throw new Error('请填写 API Key');
    if (!Array.isArray(service.models)) throw new Error('模型列表无效');
    const models: ConfiguredModel[] = service.models.map((value) => {
      const model = value as Record<string, unknown>;
      return { id: typeof model.id === 'string' && model.id ? model.id : randomUUID(), modelId: text(model.modelId, '请填写模型 ID'), name: text(model.name, '请填写模型名称'), supportsThinking: model.supportsThinking === true };
    });
    if (new Set(models.map((model) => model.id)).size !== models.length || new Set(models.map((model) => model.modelId)).size !== models.length) throw new Error('同一服务中的模型 ID 不能重复');
    return { id, name, baseUrl, protocol: protocol as ModelProtocol, apiKey, models };
  });
  if (new Set(services.map((service) => service.id)).size !== services.length) throw new Error('模型服务标识不能重复');
  const desired = fields.selectedModel === undefined ? previous?.selectedModel : fields.selectedModel as ModelSelection | null;
  const selected = services.find((service) => service.id === desired?.serviceId)?.models.find((model) => model.id === desired?.modelId);
  const first = services.find((service) => service.models.length);
  return { version: 2, services, selectedModel: selected && desired ? desired : first ? { serviceId: first.id, modelId: first.models[0].id } : null };
}

export class SettingsStore {
  value: StoredSettings | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true });
    try { this.value = normalize(JSON.parse(await readFile(join(this.directory, 'models.json'), 'utf8')), null); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  summary(): ModelSettings | null {
    if (!this.value) return null;
    return { ...this.value, services: this.value.services.map(({ apiKey, ...service }) => ({ ...service, apiKeyMasked: `••••${apiKey.length >= 8 ? apiKey.slice(-4) : ''}` })) };
  }
  private update(change: () => StoredSettings) {
    const operation = this.pending.then(async () => {
      const next = change();
      const path = join(this.directory, 'models.json');
      await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await rename(`${path}.tmp`, path);
      this.value = next;
      return this.summary();
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  save(input: unknown) { return this.update(() => normalize(input, this.value)); }
  select(input: ModelSelection) {
    return this.update(() => {
      if (!this.value || !this.value.services.find((service) => service.id === input?.serviceId)?.models.some((model) => model.id === input?.modelId)) throw new Error('所选模型不存在');
      return { ...this.value, selectedModel: { serviceId: input.serviceId, modelId: input.modelId } };
    });
  }
  model(selection = this.value?.selectedModel) {
    const service = this.value?.services.find((item) => item.id === selection?.serviceId);
    const model = service?.models.find((item) => item.id === selection?.modelId);
    if (!service || !model) throw new Error('尚未配置可用模型');
    return { service, model };
  }
}
