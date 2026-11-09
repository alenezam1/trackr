// Command-line entry points: migrate, import-sponsors, seed-demo, scan (headless, for optional Windows Task Scheduler use).
import path from 'node:path';
import os from 'node:os';
import { dataDir, getDb } from './db/db.js';
import { importSponsorCsv } from './core/sponsors/import.js';
import { bootstrap } from './index.js';
import { findLocalRegisterFiles } from './api.js';
import { DEMO_JOBS } from './fixtures/demo.js';
import { analyseJob, saveJdVersion, upsertJob } from './core/discovery/pipeline.js';
import { activeSnapshot } from './core/sponsors/import.js';
import { startScan, getRun, currentRun } from './core/discovery/scan.js';

const cmd = process.argv[2];

async function main() {
  if (cmd === 'migrate') {
    getDb(); // opening the database applies pending migrations (with a backup first)
    console.log(`Database migrated: ${path.join(dataDir(), 'trackr.sqlite')}`);
    return;
  }
  if (cmd === 'import-sponsors') {
    bootstrap();
    const file = process.argv[3] ?? findLocalRegisterFiles()[0]?.path;
    if (!file) throw new Error('No sponsor CSV found. Pass a path: npm run sponsors:import -- "C:\\path\\register.csv"');
    console.log(`Importing ${file} ...`);
    const r = await importSponsorCsv(file);
    console.log(`Snapshot ${r.snapshotId}: ${r.rowCount} rows, ${r.skilledWorkerCount} Skilled Worker, ${r.durationMs} ms`);
    bootstrap();
    return;
  }
  if (cmd === 'seed-demo') {
    // Demo data goes to a SEPARATE data directory unless TRACKR_DATA_DIR is set explicitly.
    if (!process.env.TRACKR_DATA_DIR) process.env.TRACKR_DATA_DIR = path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'SponsorFirst-DEMO');
    bootstrap();
    if (!activeSnapshot()) await importSponsorCsv(path.resolve('data/fixtures/demo-sponsors.csv'), { allowSmallFixture: true, publishedAt: new Date().toISOString().slice(0, 10), sourceUrl: 'fixture:demo' });
    for (const d of DEMO_JOBS) {
      const { jobId } = upsertJob(d, null);
      saveJdVersion(jobId, d);
      const r = await analyseJob(jobId, { allowAi: false });
      console.log(`${r.status.padEnd(28)} ${d.title}  [${r.reasons.join(', ')}]`);
    }
    console.log(`\nDEMO data written to ${process.env.TRACKR_DATA_DIR}`);
    console.log(`View it with:  $env:TRACKR_DATA_DIR="${process.env.TRACKR_DATA_DIR}"; npm run dev`);
    return;
  }
  if (cmd === 'scan') {
    bootstrap();
    const id = startScan({ mode: 'SCHEDULED' });
    console.log(`Headless scan #${id} started`);
    while (currentRun()) await new Promise((r) => setTimeout(r, 2000));
    console.log(JSON.stringify(getRun(id)?.counts, null, 2));
    return;
  }
  console.log('Usage: tsx server/cli.ts <migrate | import-sponsors [file] | seed-demo | scan>');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
