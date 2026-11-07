import type { Locator, Page } from '@playwright/test';

export class ClaimsPage {
  readonly message: Locator;
  constructor(private page: Page) {
    this.message = page.getByTestId('message');
  }

  async open() {
    await this.page.getByTestId('tab-claims').click();
  }

  async selectPolicyByRef(ref: string) {
    await this.page.getByTestId('claim-policy').selectOption({ label: ref });
  }

  async notify(opts: { lossDate: string; amount: string; description: string }) {
    await this.page.getByTestId('loss-date').fill(opts.lossDate);
    await this.page.getByTestId('claim-amount').fill(opts.amount);
    await this.page.getByTestId('claim-description').fill(opts.description);
    await this.page.getByTestId('submit-claim').click();
  }

  claimRows(): Locator {
    return this.page.getByTestId('claims-table').locator('tbody tr');
  }

  async assessFirst() {
    await this.page.getByRole('button', { name: 'Assess in full' }).first().click();
  }

  async settleFirst() {
    await this.page.getByRole('button', { name: 'Settle' }).first().click();
  }
}
