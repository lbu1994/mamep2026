import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERIAL_MOCK_SCRIPT = readFileSync(join(__dirname, 'serial-mock.js'), 'utf-8');

test.describe('E2E tests (Edge + Web Serial Mock)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(SERIAL_MOCK_SCRIPT);
    await page.goto('/');
    await page.waitForSelector('text=Mamep2026 Demo');
  });

  test('page loads with all UI regions visible', async ({ page }) => {
    await expect(page.getByText('Mamep2026 Demo')).toBeVisible();
    await expect(page.getByText('Project Bar (Register Mode)')).toBeVisible();
    await expect(page.getByText('Upload')).toBeVisible();
    await expect(page.getByText('Register[HEX]')).toBeVisible();
    await expect(page.getByText('Message List')).toBeVisible();
  });

  test('serial config modal opens and has correct fields', async ({ page }) => {
    await page.getByRole('button', { name: /串口设置/ }).click();
    await expect(page.getByRole('heading', { name: '串口设置' })).toBeVisible();
    await expect(page.getByText('Speed')).toBeVisible();
    await expect(page.getByText('Parity Bit')).toBeVisible();
    await expect(page.getByRole('spinbutton').first()).toBeVisible(); // Slave Address
    await expect(page.getByText('以下参数暂不支持')).toBeVisible();
  });

  test('serial config modal closes on cancel', async ({ page }) => {
    await page.getByRole('button', { name: /串口设置/ }).click();
    await expect(page.getByRole('heading', { name: '串口设置' })).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByRole('heading', { name: '串口设置' })).not.toBeVisible();
  });

  test('sidebar collapses and expands', async ({ page }) => {
    await page.click('text=◀');
    await expect(page.getByText('▶')).toBeVisible();
    await page.click('text=▶');
    await expect(page.getByText('◀')).toBeVisible();
  });

  test('MessageBar tab switching works', async ({ page }) => {
    await expect(page.getByText(/Wellcome/)).toBeVisible();
    await page.click('text=Comm. Log List');
    await expect(page.getByText('通信报文日志')).toBeVisible();
    await page.click('text=Comm. properties');
    await expect(page.getByText('通信属性')).toBeVisible();
    await page.click('text=OMAKE Note');
    await expect(page.getByText('自定义备注')).toBeVisible();
  });

  test('register table renders 15 rows with all columns', async ({ page }) => {
    // 15 data rows + 1 header = 16 rows
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(15);
    // Verify column headers
    await expect(page.getByRole('columnheader', { name: 'No' })).toBeVisible();
    await expect(page.getByText('Register[HEX]')).toBeVisible();
    await expect(page.getByText('Comment')).toBeVisible();
  });

  test('disabled buttons are visible but not interactable', async ({ page }) => {
    await expect(page.getByText('Enter(ROM)')).toBeDisabled();
    await expect(page.getByText('Enter(RAM)')).toBeDisabled();
    await expect(page.getByText('+ Add Row')).toBeDisabled();
    await expect(page.getByText('- Delete Row')).toBeDisabled();
    await expect(page.getByText('插件')).toBeDisabled();
  });
});
