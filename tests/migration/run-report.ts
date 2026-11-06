/** Standalone: run the migration on a scratch database and write reports/migration-report.md */
import { mkdirSync, writeFileSync } from 'node:fs';
import { applySchema, pgliteDb } from '../../shared/src/db.js';
import { migrateV1ToV2 } from '../../db/migrations/migrate-v1-to-v2.js';
import { loadLegacyData } from './legacy-data.js';
import { reconcile, renderReport } from './reconcile.js';

const db = await pgliteDb();
await applySchema(db);
await loadLegacyData(db);
const stats = await migrateV1ToV2(db);
const rec = await reconcile(db, stats);
mkdirSync('reports', { recursive: true });
writeFileSync('reports/migration-report.md', renderReport(stats, rec));
console.log(`Migration reconciliation: ${rec.passed ? 'PASS' : 'FAIL'} (see reports/migration-report.md)`);
await db.close();
process.exit(rec.passed ? 0 : 1);
