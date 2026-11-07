/**
 * Build reports/quality-summary.md from whatever reports exist: JUnit results, coverage,
 * k6 thresholds, ZAP summary and the migration reconciliation. Missing inputs are shown as "not run".
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : null);

function junit(file: string) {
  const xml = read(file);
  if (!xml) return null;
  const head = /<testsuites[^>]*>/.exec(xml)?.[0] ?? '';
  const num = (attr: string) => Number(new RegExp(`${attr}="(\\d+)"`).exec(head)?.[1] ?? 0);
  return {
    tests: num('tests'),
    failures: num('failures') + num('errors'),
    skipped: num('skipped'),
  };
}

const suites: [string, string][] = [
  ['Unit (Vitest)', 'reports/junit-unit.xml'],
  ['API + E2E (Playwright)', 'reports/junit-playwright.xml'],
  ['Postman (Newman)', 'reports/junit-newman.xml'],
  ['SQL, events, migration, contract, AI tool (Vitest)', 'reports/junit-integration.xml'],
];

const rows = suites.map(([name, file]) => {
  const r = junit(file);
  if (!r) return `| ${name} | not run | | | |`;
  const status = r.failures === 0 ? 'PASS' : 'FAIL';
  return `| ${name} | ${status} | ${r.tests} | ${r.failures} | ${r.skipped} |`;
});

const cov = read('reports/coverage/coverage-summary.json');
let coverage = '_not run_';
if (cov) {
  const t = JSON.parse(cov).total;
  coverage = `lines ${t.lines.pct}%, branches ${t.branches.pct}%, functions ${t.functions.pct}% (gate: 90 / 85 / 90)`;
}

const k6 = readdirSync(existsSync('reports') ? 'reports' : '.')
  .filter((f) => /^k6-.*\.json$/.test(f))
  .map((f) => {
    const m = JSON.parse(readFileSync(`reports/${f}`, 'utf8')).metrics;
    const p95 = m.http_req_duration?.['p(95)'] ?? m.http_req_duration?.values?.['p(95)'];
    const failed = m.http_req_failed?.value ?? m.http_req_failed?.values?.rate;
    const reqs = m.http_reqs?.count ?? m.http_reqs?.values?.count;
    return `| ${f.replace(/^k6-|\.json$/g, '')} | ${reqs} | ${Number(p95).toFixed(0)} ms | ${(Number(failed) * 100).toFixed(2)}% |`;
  });

const zap = read('reports/zap-summary.md');
const migration = read('reports/migration-report.md');
const migrationResult = migration
  ? (/Overall result: \*\*(\w+)\*\*/.exec(migration)?.[1] ?? 'unknown')
  : 'not run';

const out = `# Quality summary

Generated ${new Date().toISOString()}

## Test results
| Suite | Result | Tests | Failed | Skipped |
| --- | --- | ---: | ---: | ---: |
${rows.join('\n')}

Skipped/expected-failure note: tests tagged with a DEF-00x id assert correct behaviour and are marked as
expected failures (\`it.fails\` / \`test.fail\`) while the planted defect exists. See docs/planted-defects.md.

## Coverage (calculation core)
${coverage}

## Performance (k6, short CI run)
${k6.length ? `| Script | Requests | p95 | Failed |\n| --- | ---: | ---: | ---: |\n${k6.join('\n')}` : '_not run_'}

## Security (OWASP ZAP)
${zap ? zap.split('\n').slice(2).join('\n') : '_not run_'}

## Data migration reconciliation
${migrationResult}

## Quality gates
- Coverage threshold met: ${cov ? 'see Coverage' : 'not run'}
- Zero failed smoke tests, k6 thresholds and zero high ZAP alerts are enforced as failing pipeline steps.
`;
mkdirSync('reports', { recursive: true });
writeFileSync('reports/quality-summary.md', out);
console.log(out);
