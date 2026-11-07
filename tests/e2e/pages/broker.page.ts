import type { Locator, Page } from '@playwright/test';

export class BrokerPage {
  readonly message: Locator;
  constructor(private page: Page) {
    this.message = page.getByTestId('message');
  }

  async open() {
    await this.page.goto('/');
    await this.page.getByTestId('tab-broker').click();
    await this.page.getByTestId('broker-select').locator('option').first().waitFor({ state: 'attached' });
  }

  async submitRisk(opts: { type?: 'marine_cargo' | 'commercial_property'; value: string; description: string }) {
    await this.page.getByTestId('risk-type').selectOption(opts.type ?? 'marine_cargo');
    await this.page.getByTestId('insured-value').fill(opts.value);
    await this.page.getByTestId('risk-description').fill(opts.description);
    await this.page.getByTestId('submit-risk').click();
  }
}
