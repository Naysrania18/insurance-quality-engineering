/**
 * Quality gate over ZAP JSON reports in reports/zap: fails when any High-risk alert exists.
 * Writes reports/zap-summary.md with a per-service table for the quality summary and triage doc.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const services = ['quote', 'policy', 'claims'];
const names = ['Informational', 'Low', 'Medium', 'High'];
let high = 0;
const lines = [
  '# OWASP ZAP summary',
  '',
  '| Service | High | Medium | Low | Informational |',
  '| --- | ---: | ---: | ---: | ---: |',
];
const detail: string[] = [];

for (const svc of services) {
  const file = `reports/zap/${svc}.json`;
  if (!existsSync(file)) {
    lines.push(`| ${svc} | no report | | | |`);
    continue;
  }
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const counts = [0, 0, 0, 0];
  for (const site of report.site ?? []) {
    for (const alert of site.alerts ?? []) {
      const risk = Number(alert.riskcode);
      counts[risk]++;
      detail.push(
        `- **${svc}** [${names[risk]}] ${alert.name} (plugin ${alert.pluginid}, ${alert.count} instance(s))`,
      );
    }
  }
  high += counts[3];
  lines.push(`| ${svc} | ${counts[3]} | ${counts[2]} | ${counts[1]} | ${counts[0]} |`);
}
lines.push('', '## Alerts', '', ...(detail.length ? detail : ['_None._']));
mkdirSync('reports', { recursive: true });
writeFileSync('reports/zap-summary.md', lines.join('\n'));
console.log(lines.join('\n'));
if (high > 0) {
  console.error(`\nQuality gate FAILED: ${high} high-risk ZAP alert(s)`);
  process.exit(1);
}
console.log('\nQuality gate passed: no high-risk ZAP alerts');
