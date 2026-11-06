import type { Page } from '@playwright/test';

export async function revealTool(page: Page, name: RegExp) {
  const button = page.getByRole('button', { name, includeHidden: true });
  await button.waitFor({ state: 'attached' });
  const group = page.getByTestId('activity-group').filter({ has: button });
  const summary = group.getByRole('button').first();
  if (await summary.getAttribute('aria-expanded') === 'false') await summary.click();
  return page.getByRole('button', { name });
}
