import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit-unit.xml' },
    coverage: {
      provider: 'v8',
      include: ['shared/src/pricing.ts', 'shared/src/coinsurance.ts', 'shared/src/money.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'reports/coverage',
      // Quality gate: unit coverage of the calculation core
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
