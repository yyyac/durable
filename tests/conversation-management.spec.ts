import { openModelSettings, saveModelSettings } from './configure-model';
import { test, expect } from './fixtures';

test('会话重命名针对菜单所选记录并持久化，当前标题同步且其它历史不变', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await openModelSettings(page);
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('management-test-key');
  await page.getByLabel('模型 ID', { exact: true }).fill('test-model');
  await page.getByLabel('模型名称', { exact: true }).fill('会话管理模型');
  await saveModelSettings(page);
  for (const title of ['甲的原始问题', '乙的独立问题']) {
    if (title.startsWith('乙')) await page.getByRole('button', { name: '新建会话', exact: true }).click();
    upstream.enqueue({ chunks: [`${title}的答案`] });
    await page.getByRole('textbox', { name: '输入消息' }).fill(title);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByTestId('assistant-message')).toHaveText(`${title}的答案`);
  }
  await page.getByRole('button', { name: '甲的原始问题的会话菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('会话名称').fill('甲的新名称');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('button', { name: '甲的新名称', exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-message')).toHaveText('乙的独立问题的答案');
  await page.getByRole('button', { name: '甲的新名称', exact: true }).click();
  await expect(page.getByRole('heading', { name: '会话标题' })).toHaveText('甲的新名称');
  await expect(page.getByTestId('assistant-message')).toHaveText('甲的原始问题的答案');
  await page.reload();
  await expect(page.getByRole('heading', { name: '会话标题' })).toHaveText('甲的新名称');
  await expect(page.getByRole('button', { name: '乙的独立问题', exact: true })).toBeVisible();
  expect(upstream.requests).toHaveLength(2);
});

test('搜索打开归档会话，菜单操作不串改其它会话且刷新后仍可读取历史', async ({ page, workbench, upstream }) => {
  await page.goto(workbench.url);
  await openModelSettings(page);
  await page.getByLabel('接口地址').fill(upstream.url);
  await page.getByLabel('API Key', { exact: true }).fill('archive-test-key');
  await page.getByLabel('模型 ID', { exact: true }).fill('test-model');
  await page.getByLabel('模型名称', { exact: true }).fill('归档测试模型');
  await saveModelSettings(page);
  for (const title of ['甲的项目', '乙的计划']) {
    if (title.startsWith('乙')) await page.getByRole('button', { name: '新建会话', exact: true }).click();
    upstream.enqueue({ chunks: [`${title}的历史`] });
    await page.getByRole('textbox', { name: '输入消息' }).fill(title);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByTestId('assistant-message')).toHaveText(`${title}的历史`);
  }
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索会话' }).fill('甲');
  const search = page.getByRole('dialog', { name: '搜索会话' });
  await expect(search.getByRole('button', { name: '甲的项目', exact: true })).toBeVisible();
  await expect(search.getByRole('button', { name: '乙的计划', exact: true })).toHaveCount(0);
  await search.getByRole('button', { name: '甲的项目', exact: true }).click();
  await expect(page.getByTestId('assistant-message')).toHaveText('甲的项目的历史');
  await page.getByRole('button', { name: '甲的项目的会话菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '归档', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '会话列表' }).getByRole('button', { name: '甲的项目', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '会话标题' })).toHaveText('乙的计划');
  await expect(page.getByTestId('assistant-message')).toHaveText('乙的计划的历史');
  await page.reload();
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索会话' }).fill('甲');
  await page.screenshot({ path: 'C:/Users/yyya/.codex/visualizations/2026/11/05/01a1aa98-cbf6-74a3-b305-5cdf00994c45/conversation-search.png' });
  await search.getByRole('button', { name: '甲的项目 已归档', exact: true }).click();
  await expect(page.getByRole('heading', { name: '会话标题' })).toHaveText('甲的项目');
  await expect(page.getByTestId('assistant-message')).toHaveText('甲的项目的历史');
  await page.reload();
  await expect(page.getByRole('heading', { name: '会话标题' })).toHaveText('甲的项目');
  await expect(page.getByTestId('assistant-message')).toHaveText('甲的项目的历史');
  await page.getByRole('button', { name: '乙的计划', exact: true }).click();
  await page.getByRole('button', { name: '乙的计划的会话菜单', exact: true }).click();
  await page.screenshot({ path: 'C:/Users/yyya/.codex/visualizations/2026/11/05/01a1aa98-cbf6-74a3-b305-5cdf00994c45/conversation-menu.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '乙的计划的会话菜单', exact: true })).toBeFocused();
  expect(upstream.requests).toHaveLength(2);
});
