// Previews for the 1 Nov tweaks (Yards, Attendance in the Menu, Not recorded, calmer Refined): TWEAK_SHOTS=<dir> [TWEAK_W=412] [THEME=ops-refined] node ops-tweaks-shots.mjs
import { fs, path, makeDb, phone, open, browser, sleep, now } from './harness.mjs';
const dir = process.env.TWEAK_SHOTS || '/tmp/tweak-shots'; fs.mkdirSync(dir, { recursive: true });
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const W = +(process.env.TWEAK_W || 412);
const fixture = () => {
  const db = makeDb(); db.company.name = 'Airport Parking Bay';
  db.company.brand = { theme: process.env.THEME || 'ops-refined', colour: '#1560BD', ink: '#FFFFFF', short: 'Airport Parking Bay', attendance: true, collections: true, topup: true };
  db.company.exit_fee = 10; db.company.yards = ['T', 'GS', 'MY'];
  db.aero = { manager: true, sites: [], open: { id: 'sh1', clock_in_at: ago(192), worksite_id: 'w1' }, shifts: [] };
  const [a, b, c] = db.bookings, sh = a.sheet_id;
  Object.assign(a, { reg: 'WR71LPX', yard: 'GS', exit_method: 'card', exit_amount: 10, exit_at: now(), exit_photo: 'c1/docs/b1/x.jpg', sent: true, sent_at: now(), cleared: true, cleared_at: now() });
  Object.assign(b, { reg: 'LD09EPO', yard: 'T', called: true, called_at: now() });
  Object.assign(c, { reg: 'EJ71FJO', yard: 'MY', sent: true, sent_at: now(), cleared: true, cleared_at: now() });
  const act = (m, reg, action, value, who = 'NIKHIL', id = a.id) => ({ id: 'a' + m, at: ago(m), reg, action, value, staff_name: who, sheet_id: sh, booking_id: id });
  db.activity = [act(2, 'LD09EPO', 'CALLED', 'Called', 'KAMU', b.id), act(5, 'WR71LPX', 'CLEAR', 'Collected'), act(6, 'WR71LPX', 'EXIT FEE', '£10.00 card (photo)'),
    act(9, 'EJ71FJO', 'YARD', 'MY', 'KAMU', c.id), act(14, 'KR25YDB', 'YARD', 'T · from PICKS', 'SYSTEM'), act(21, 'EJ71FJO', 'KEY CHECK', 'found · k1', 'NIKHIL', c.id),
    act(30, 'LD09EPO', 'LANE MOVE', 'Lane B · 3 → Lane A · 1', 'KAMU', b.id), act(40, 'EJ71FJO', 'CALLED', 'Called', 'KAMU', c.id)];
  return db;
};
const shot = async (p, name, clip) => { await p.screenshot({ path: path.join(dir, name + '.png'), clip }); console.log('shot', name, JSON.stringify(p.__errors)); };
const menu = async (p) => { await p.evaluate(() => (document.querySelector('#bnav [data-bn=menuBtn]') || document.getElementById('menuBtn')).click()); await p.waitForSelector('#menu[open]'); await sleep(900); };
try {
  const db = fixture(); const p = await phone(browser, db, { width: W }); await p.setViewportSize({ width: W, height: W < 900 ? 900 : 1000 });
  await open(p); await sleep(1200);
  await p.addStyleTag({ content: '.pend{display:none!important}' });
  await shot(p, 'bar', { x: 0, y: 0, width: W, height: 70 });
  // Collections: Needs checking picked
  await p.click('[data-payfilter="check"]').catch(() => {}); await sleep(400);
  await shot(p, 'collections');
  await menu(p); await shot(p, 'menu');
  await p.click('#menuBody [data-view="summary"]'); await sleep(1500);
  await p.evaluate(() => document.querySelector('.actbar').scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -150)); await sleep(200);
  await shot(p, 'activity-all');
  const yb = await p.$('[data-actf="yards"]'); if (yb) { await yb.click(); await sleep(300); await p.evaluate(() => document.querySelector('.actbar').scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -150)); await sleep(200); await shot(p, 'activity-yards'); }
} finally { await browser.close(); process.exit(0); }
