import { test as base, expect } from '@playwright/test';
import { Journey } from './client.js';
import { BrokerPage } from '../e2e/pages/broker.page.js';
import { UnderwriterPage } from '../e2e/pages/underwriter.page.js';
import { ClaimsPage } from '../e2e/pages/claims.page.js';

export const serviceUrls = {
  quote: process.env.QUOTE_URL ?? 'http://127.0.0.1:3001',
  policy: process.env.POLICY_URL ?? 'http://127.0.0.1:3002',
  claims: process.env.CLAIMS_URL ?? 'http://127.0.0.1:3003',
};

interface Fixtures {
  journey: Journey;
  brokerPage: BrokerPage;
  underwriterPage: UnderwriterPage;
  claimsPage: ClaimsPage;
}

/** Custom fixtures: API journey helper for fast setup, and page objects for UI steps. */
export const test = base.extend<Fixtures>({
  journey: async ({}, use) => {
    await use(new Journey(serviceUrls));
  },
  brokerPage: async ({ page }, use) => {
    await use(new BrokerPage(page));
  },
  underwriterPage: async ({ page }, use) => {
    await use(new UnderwriterPage(page));
  },
  claimsPage: async ({ page }, use) => {
    await use(new ClaimsPage(page));
  },
});

export { expect };
