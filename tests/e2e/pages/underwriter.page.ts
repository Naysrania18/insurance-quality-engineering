import type { Locator, Page } from '@playwright/test';

export class UnderwriterPage {
  readonly message: Locator;
  constructor(private page: Page) {
    this.message = page.getByTestId('message');
  }

  async open() {
    await this.page.getByTestId('tab-underwriter').click();
  }

  riskRowByText(text: string): Locator {
    return this.page.getByTestId('submitted-risks').locator('tbody tr', { hasText: text });
  }

  async quoteRisk(description: string) {
    await this.riskRowByText(description).getByRole('button', { name: 'Quote' }).click();
  }

  /** Bind the quote created most recently (newest first in the list). */
  async bindFirstQuote() {
    await this.page
      .getByTestId('quoted-risks')
      .getByRole('button', { name: 'Bind' })
      .first()
      .click();
  }

  policyRows(): Locator {
    return this.page.getByTestId('policies').locator('tbody tr');
  }
}
