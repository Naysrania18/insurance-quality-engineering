import { randomUUID } from 'node:crypto';
import { expect, test } from '../support/fixtures.js';

test.describe('platform UI', () => {
  test('home page loads with the three journeys @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Insurance Platform/);
    await expect(page.getByTestId('tab-broker')).toBeVisible();
    await expect(page.getByTestId('tab-underwriter')).toBeVisible();
    await expect(page.getByTestId('tab-claims')).toBeVisible();
    await expect(page.getByText('demo system for testing practice')).toBeVisible();
  });

  test('broker can submit a risk @smoke @regression', async ({ brokerPage }) => {
    await brokerPage.open();
    await brokerPage.submitRisk({ value: '250000', description: `Cargo ${randomUUID()}` });
    await expect(brokerPage.message).toContainText('Risk submitted');
  });

  test('broker sees a clear error when the insured value is below appetite @regression', async ({
    brokerPage,
  }) => {
    await brokerPage.open();
    await brokerPage.submitRisk({ value: '5', description: 'Too small' });
    await expect(brokerPage.message).toHaveClass(/error/);
    await expect(brokerPage.message).toContainText(/insuredValueCents/);
  });

  test('broker cannot submit a risk without a description @regression', async ({ brokerPage }) => {
    await brokerPage.open();
    await brokerPage.submitRisk({ value: '250000', description: '' });
    await expect(brokerPage.message).toHaveClass(/error/);
  });
});

test.describe('full journey @e2e', () => {
  test('submit risk -> quote -> bind -> notify claim -> assess -> settle @e2e @smoke', async ({
    page,
    brokerPage,
    underwriterPage,
    claimsPage,
  }) => {
    const description = `Marine cargo ${randomUUID()}`;

    await test.step('broker submits a marine cargo risk', async () => {
      await brokerPage.open();
      await brokerPage.submitRisk({ value: '250000.00', description });
      await expect(brokerPage.message).toContainText('Risk submitted');
    });

    await test.step('underwriter quotes the risk', async () => {
      await underwriterPage.open();
      await expect(underwriterPage.riskRowByText(description)).toBeVisible();
      await underwriterPage.quoteRisk(description);
      await expect(underwriterPage.message).toContainText('Quote created');
      await expect(page.getByTestId('quoted-risks')).toContainText('2000.00'); // 250,000 x 0.80%
    });

    let policyRef = '';
    await test.step('underwriter binds the quote; premium is split across the panel', async () => {
      await underwriterPage.bindFirstQuote();
      await expect(underwriterPage.message).toContainText('Policy bound');
      policyRef = ((await underwriterPage.message.textContent()) ?? '').replace('Policy bound: ', '').trim();
      const row = underwriterPage.policyRows().filter({ hasText: policyRef });
      await expect(row).toContainText('Alder Mutual');
      await expect(row).toContainText('Cobalt Underwriters');
    });

    await test.step('a claim is notified against the policy', async () => {
      await claimsPage.open();
      await claimsPage.selectPolicyByRef(policyRef);
      await claimsPage.notify({ lossDate: '2026-01-10', amount: '15000', description: 'Container water damage' });
      await expect(claimsPage.message).toContainText('Claim notified');
      await expect(claimsPage.claimRows().first()).toContainText('NOTIFIED');
    });

    await test.step('the claim is assessed and settled', async () => {
      await claimsPage.assessFirst();
      await expect(claimsPage.claimRows().first()).toContainText('ASSESSED');
      await claimsPage.settleFirst();
      await expect(claimsPage.claimRows().first()).toContainText('SETTLED');
      await expect(claimsPage.claimRows().first()).toContainText('15000.00');
    });
  });

  // KNOWN DEFECT DEF-001 (docs/defects/DEF-001-share-rounding.md): the shares shown to the user for a
  // 10,000.70 risk add up to 80.02, not the 80.01 premium. Expected to fail until the defect is fixed.
  test('DEF-001: displayed insurer shares add up to the premium @e2e @regression', async ({
    page,
    brokerPage,
    underwriterPage,
  }) => {
    test.fail(true, 'DEF-001: share rounding. See docs/defects/DEF-001-share-rounding.md');
    const description = `Rounding probe ${randomUUID()}`;
    await brokerPage.open();
    await brokerPage.submitRisk({ value: '10000.70', description });
    await underwriterPage.open();
    await underwriterPage.quoteRisk(description);
    await underwriterPage.bindFirstQuote();
    await expect(underwriterPage.message).toContainText('Policy bound');
    const policyRef = ((await underwriterPage.message.textContent()) ?? '').replace('Policy bound: ', '').trim();
    const row = underwriterPage.policyRows().filter({ hasText: policyRef });
    await expect(row).toBeVisible();
    const text = (await row.innerText()).replace(policyRef, '');
    const amounts = [...text.matchAll(/= (\d+\.\d{2})/g)].map((m) => Math.round(Number(m[1]) * 100));
    const premium = Math.round(Number((await row.locator('td').nth(1).innerText()).trim()) * 100);
    expect(premium).toBe(8001);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(premium);
  });
});
