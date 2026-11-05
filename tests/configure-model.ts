import type { Page } from '@playwright/test';
import type { ModelProtocol } from '../src/types';

type ModelForm = { apiKey?: string; modelId?: string; name?: string; protocol?: ModelProtocol; supportsThinking?: boolean };

export async function configureModel(page: Page, baseUrl: string, model: ModelForm = {}) {
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('接口地址').fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill(model.apiKey ?? 'test-secret-do-not-echo');
  await page.getByLabel('模型 ID', { exact: true }).fill(model.modelId ?? 'test-model');
  await page.getByLabel('模型名称', { exact: true }).fill(model.name ?? '本地测试模型');
  await page.getByLabel('接口协议').selectOption(model.protocol ?? 'openai-completions');
  await page.getByRole('checkbox', { name: '支持思考内容', exact: true }).setChecked(model.supportsThinking ?? false);
  await page.getByRole('button', { name: '保存配置' }).click();
}
