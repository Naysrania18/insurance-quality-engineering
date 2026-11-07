import { defineConfig, devices } from '@playwright/test';

const external = Boolean(process.env.BASE_URL);
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

/**
 * Two projects:
 *  - api: Playwright APIRequestContext tests against the three services
 *  - e2e: browser journeys through the web UI (Page Object Model)
 * Without BASE_URL the platform is started in-process (PGlite + in-memory bus), no Docker needed.
 * With BASE_URL (CI) it targets the docker-compose stack.
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: ['api/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
    ['junit', { outputFile: 'reports/junit-playwright.xml' }],
    ['json', { outputFile: 'reports/playwright-results.json' }],
  ],
  outputDir: 'reports/playwright-artifacts',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'api', testMatch: 'api/**/*.spec.ts' },
    { name: 'e2e', testMatch: 'e2e/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: external
    ? undefined
    : {
        command: 'npx tsx scripts/dev-all.ts',
        url: 'http://127.0.0.1:3000/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
