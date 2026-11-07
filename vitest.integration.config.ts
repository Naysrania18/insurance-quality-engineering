import { defineConfig } from 'vitest/config';

/** Integration-style suites: SQL, events, migration, contract, resilience, AI tool. */
export default defineConfig({
  test: {
    include: [
      'tests/{sql,events,migration,contract,resilience}/**/*.test.ts',
      'ai-testing/**/*.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit-integration.xml' },
  },
});
