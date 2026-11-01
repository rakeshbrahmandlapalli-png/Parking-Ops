// Desktop previews of Operations Refined (Airport Parking Bay's look) at 1440 px, every main page.
// DESK_SHOTS=<dir> [DESK_CSS=<file>] [DESK_W=1440] [THEME=ops-refined] node ops-desktop-shots.mjs
// DESK_CSS injects a proposed stylesheet after the app loads (previews only, nothing in the app changes).
import { fs, path, phone, open, browser, sleep, deskDb, apbBrand, biDb, dashData, dashExit } from './harness.mjs';
const dir = process.env.DESK_SHOTS || '/tmp/desk-shots'; fs.mkdirSync(dir, { recursive: true });
const W = +(process.env.DESK_W || 1440), H = 900, theme = process.env.THEME || 'ops-refined';
const css = process.env.DESK_CSS ? fs.readFileSync(process.env.DESK_CSS, 'utf8') : '';
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const build = () => {
  const db = deskDb(theme);
  db.company = { ...db.company, name: 'Airport Parking Bay', slug: 'airport-parking-bay', yards: ['GS', 'MY', 'T'], yard_colours: { GS: '#E8590C', MY: '#2F9E44', T: '#FFE600' } };
  db.company.brand = { ...apbBrand(theme), theme, picks_yard: true, attendance: true, collections: true };
  for (const b of db.bookings) if (b.yard) b.yard = { CP: 'GS', NY: 'MY', S: 'T', T: 'T' }[b.yard] || b.yard;
  { const bi = biDb(theme); Object.assign(db, { autoImport: bi.autoImport, reviews: bi.reviews, preview: bi.preview, imports: bi.imports }); }
  db.company.overstay_rate = 30; db.company.exit_fee = 10; db.company.exit_free = ['CAP']; db.company.capacity = 40; db.dash = dashData(); db.dash.exit = dashExit();
  db.me = { ...db.me, role: 'owner' };
  db.staff.push({ id: 's3', name: 'ANIL', role: 'office', active: true, user_id: 'u3' }, { id: 's4', name: 'NIKHIL', role: 'terminal', active: true, user_id: 'u4' },
    { id: 's5', name: 'RAIHAN', role: 'terminal', active: true, user_id: 'u5' }, { id: 's6', name: 'KAMU', role: 'bongo', active: true, user_id: 'u6' }, { id: 's7', name: 'OLD DRIVER', role: 'bongo', active: false });
  (db.staff.find((x) => x.id === db.me.id) || {}).user_id = 'u1';
  db.aero = { manager: true, sites: [], shifts: [], open: { id: 'sh1', clock_in_at: ago(192), worksite_id: 'w1' }, openAll: [
    { id: 'sh1', user_id: 'u1', clock_in_at: ago(192), worksite_id: 'w1' }, { id: 'sh3', user_id: 'u3', clock_in_at: ago(118), worksite_id: 'w2' }, { id: 'sh6', user_id: 'u6', clock_in_at: ago(64), worksite_id: 'w1' }] };
  db.aeroSites = [{ id: 'w1', name: 'Millfield Lane', radius_m: 200 }, { id: 'w2', name: 'Airport', radius_m: 200 }];
  db.att = { s3: { attendance: true, locked: true, on_shift: true }, s5: { attendance: true, locked: true, on_shift: false }, s6: { attendance: true, locked: false, on_shift: true } };
  db.seen = [{ id: 's2', seen_at: ago(2) }, { id: 's3', seen_at: ago(1) }, { id: 's4', seen_at: ago(180) }, { id: 's6', acted_at: ago(2 * 1440) }];
  db.activity = [{ at: ago(10), action: 'SENT', value: '', reg: 'KL12PQR', staff_id: 's2', staff_name: 'SUGU', booking_id: 'w6' }, { at: ago(14), action: 'CALLED', value: '', reg: 'CD34EFG', staff_id: 's3', staff_name: 'ANIL', booking_id: 'w2' },
    { at: ago(40), action: 'CLEAR', value: 'Collected', reg: 'YZ56CDE', staff_id: 's2', staff_name: 'SUGU', booking_id: 'w13' }, { at: ago(62), action: 'YARD', value: 'MY', reg: 'EF56GHI', staff_id: 's6', staff_name: 'KAMU', booking_id: 'w3' }];
  return db;
};
let page;
const snap = async (n, full = true) => {
  await sleep(700);
  if (full) { const h = Math.min(2400, await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, innerHeight))); await page.setViewportSize({ width: W, height: Math.max(H, h) }); await sleep(250); }
  if (process.env.DUMP) fs.writeFileSync(path.join(dir, n + '.html'), await page.evaluate(() => (document.querySelector('dialog[open]') || document.querySelector('.top') && document.body).outerHTML));
  await page.screenshot({ path: path.join(dir, n + '.png') }); await page.setViewportSize({ width: W, height: H }); console.log('shot', n);
};
const menu = async () => { await page.evaluate(() => (document.querySelector('#bnav [data-bn=menuBtn]') || document.getElementById('menuBtn')).click()); await page.waitForSelector('#menu[open]'); await sleep(400); };
const view = async (v) => { if (!(await page.$('#menu[open]'))) await menu(); await page.click('#menuBody [data-view="' + v + '"]'); await sleep(900); };
const esc = async () => { await page.keyboard.press('Escape'); await sleep(300); };
try {
  page = await phone(browser, build(), { width: W }); await page.setViewportSize({ width: W, height: H });
  await open(page); await sleep(1200);
  if (css) await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: '.pend{display:none!important}' });
  await sleep(400);
  await snap('01-board-drops', false);
  await page.click('#kindBar [data-kind="picks"]'); await sleep(900); await snap('02-board-picks', false);
  await page.click('#kindBar [data-kind="drops"]'); await sleep(900);
  await page.click('.row[data-id="w2"] .reg, .drow[data-id="w2"] .reg').catch(() => {}); await sleep(700); await snap('03-booking-details', false); await esc();
  await page.click('#bnav [data-bn="flBtn"]'); await sleep(1000); await snap('04-flights');
  await page.click('#bnav [data-bn="psBtn"]'); await sleep(1000); await snap('05-stats');
  await page.click('#bnav [data-bn="logBtn"]'); await sleep(1000); await snap('06-summary');
  await page.click('#bnDash'); await sleep(1500); await snap('07-dashboard');
  await view('staff'); await snap('08-staff');
  const dd = page.locator('#main .ops-person', { hasText: 'ANIL' }).locator('.ops-dd summary'); if (await dd.count()) { await dd.click(); await sleep(150); }
  await page.click('[data-manage="s3"]').catch(() => {}); await sleep(700); await snap('09-staff-person', false); await esc();
  await page.click('#bnSet'); await sleep(1200); await snap('10-settings');
  await view('import'); await snap('11-import');
  await view('archive'); await page.fill('#archQ', 'CD34').catch(() => {}); await page.click('#archGo').catch(() => {}); await snap('12-archive');
  await page.click('#bnBoard'); await sleep(500); await menu(); await snap('13-menu', false); await esc();
} catch (e) { console.log("ERR", e.message.slice(0, 400)); } finally { await browser.close(); process.exit(0); }
