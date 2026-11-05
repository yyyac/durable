import { expect, type Page } from '@playwright/test';
import type { ModelProtocol } from '../src/types';

type ModelForm = { apiKey?: string; modelId?: string; name?: string; protocol?: ModelProtocol; supportsThinking?: boolean; contextWindow?: number; maxTokens?: number };

async function openSupplierList(page: Page) {
  if (!(await page.getByRole('dialog', { name: '模型设置' }).isVisible())) await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('region', { name: '自定义供应商', exact: true })).toBeVisible();
}

export async function addModelService(page: Page) {
  await openSupplierList(page);
  await page.getByRole('button', { name: '添加供应商', exact: true }).click();
}

export async function openModelSettings(page: Page, name?: string) {
  await openSupplierList(page);
  const providers = page.getByRole('region', { name: '自定义供应商', exact: true });
  if (name) await providers.getByRole('button', { name, exact: true }).click();
  else if (await providers.getByRole('button').count()) await providers.getByRole('button').first().click();
  else await page.getByRole('button', { name: '添加供应商', exact: true }).click();
}

export async function saveModelSettings(page: Page) {
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByRole('region', { name: '自定义供应商', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
}

export async function selectProtocol(page: Page, protocol: ModelProtocol) {
  const labels: Record<ModelProtocol, string> = { 'openai-completions': 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages' };
  await page.getByRole('button', { name: '接口协议', exact: true }).click();
  await page.getByRole('menuitemradio', { name: labels[protocol], exact: true }).click();
}

export async function configureModel(page: Page, baseUrl: string, model: ModelForm = {}) {
  await openModelSettings(page);
  await page.getByLabel('接口地址').fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill(model.apiKey ?? 'test-secret-do-not-echo');
  await page.getByLabel('模型 ID', { exact: true }).fill(model.modelId ?? 'test-model');
  await page.getByLabel('模型名称', { exact: true }).fill(model.name ?? '本地测试模型');
  await selectProtocol(page, model.protocol ?? 'openai-completions');
  await page.getByRole('checkbox', { name: '支持思考内容', exact: true }).setChecked(model.supportsThinking ?? false);
  if (model.contextWindow !== undefined) await page.getByLabel('上下文', { exact: true }).fill(String(model.contextWindow));
  if (model.maxTokens !== undefined) await page.getByLabel('最大输出', { exact: true }).fill(String(model.maxTokens));
  await saveModelSettings(page);
}
