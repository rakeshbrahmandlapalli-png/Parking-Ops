// Previews for the saved board while on shift (4 Nov): OFFLINE_SHOTS=<dir> node offline-board-shots.mjs
import { fs, path, makeDb, phone, open, browser, sleep } from './harness.mjs';
const dir = process.env.OFFLINE_SHOTS || '/tmp/offline-shots'; fs.mkdirSync(dir, { recursive: true });
try {
  const db = makeDb(); db.company.brand = { theme: process.env.THEME || 'ops', colour: '#F9A01B', ink: '#172536', short: 'TakeOff', attendance: true };
  db.gate = { gated: true, closed: false, name: 'RAKESH', company: 'TAKEOFF', attendance: true };
  db.aero = { manager: true, sites: [], open: { id: 'sh1', clock_in_at: new Date(Date.now() - 125 * 60000).toISOString(), worksite_id: 'w1' }, shifts: [] };
  const p = await phone(browser, db, { width: 390 }); await p.setViewportSize({ width: 390, height: 844 });
  await open(p); await sleep(2600);
  await p.screenshot({ path: path.join(dir, '1-on-shift-online.png') });
  db.down = true; await p.reload(); await sleep(3200);
  await p.screenshot({ path: path.join(dir, '2-no-signal-opened.png') });
  await p.click('.row[data-id="b1"] [data-act="sent"]').catch(() => {}); await sleep(5000);
  await p.screenshot({ path: path.join(dir, '3-no-signal-tap-waiting.png') });
  db.down = false; await p.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(4000);
  await p.screenshot({ path: path.join(dir, '4-back-online.png') });
  console.log('errors', JSON.stringify(p.__errors));
} finally { await browser.close(); process.exit(0); }
