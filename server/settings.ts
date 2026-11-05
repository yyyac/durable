import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelSettings } from '../src/types.js';

export type StoredSettings = Omit<ModelSettings, 'apiKeyMasked'> & { apiKey: string };

export class SettingsStore {
  value: StoredSettings | null = null;
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true });
    try { this.value = JSON.parse(await readFile(join(this.directory, 'models.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  summary(): ModelSettings | null {
    if (!this.value) return null;
    const { apiKey, ...settings } = this.value;
    return { ...settings, apiKeyMasked: `••••${apiKey.length >= 8 ? apiKey.slice(-4) : ''}` };
  }
  async save(input: unknown) {
    if (!input || typeof input !== 'object') throw new Error('模型配置无效');
    const fields = input as Record<string, unknown>;
    for (const name of ['baseUrl', 'modelId', 'name']) {
      if (typeof fields[name] !== 'string' || !fields[name].trim()) throw new Error('请完整填写接口地址、模型 ID 和模型名称');
    }
    const url = new URL(fields.baseUrl as string);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('接口地址必须使用 HTTP 或 HTTPS');
    const apiKey = typeof fields.apiKey === 'string' && fields.apiKey ? fields.apiKey : this.value?.apiKey;
    if (!apiKey) throw new Error('请填写 API Key');
    if (fields.protocol !== undefined && !['openai-completions', 'anthropic-messages'].includes(fields.protocol as string)) throw new Error('不支持的接口协议');
    const next: StoredSettings = { baseUrl: (fields.baseUrl as string).trim().replace(/\/$/, ''), modelId: (fields.modelId as string).trim(), name: (fields.name as string).trim(), apiKey, supportsThinking: fields.supportsThinking === true || fields.supportsThinking === 'on', protocol: fields.protocol === 'anthropic-messages' ? fields.protocol : 'openai-completions' };
    const path = join(this.directory, 'models.json');
    await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(`${path}.tmp`, path);
    this.value = next;
    return this.summary();
  }
}
