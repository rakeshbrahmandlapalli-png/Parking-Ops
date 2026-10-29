// Preview screenshots of clocking in and out inside Parking Ops: ATT_SHOTS=<dir> node attendance-ui-shots.mjs
import { fs, path, makeDb, phone, open, browser, server, sleep, BASE } from './harness.mjs';
const dir = process.env.ATT_SHOTS || '/tmp/att-shots'; fs.mkdirSync(dir, { recursive: true });
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const SITES = [{ id: 'w1', name: 'Millfield Lane', lat: 51.8609617, lng: -0.4728942, radius_m: 200 }, { id: 'w2', name: 'Airport', lat: 51.877055, lng: -0.3737165, radius_m: 200 }];
const HERE = { latitude: 51.8611, longitude: -0.4731, accuracy: 12 }, FAR = { latitude: 51.8800, longitude: -0.4200, accuracy: 15 };
const fixture = (theme, onShift) => {
  const db = makeDb(); db.company.brand = { theme, colour: '#F9A01B', ink: '#172536', short: 'TakeOff', attendance: true };
  db.aero = { manager: false, sites: SITES, open: onShift ? { id: 'sh1', clock_in_at: ago(192), worksite_id: 'w1' } : null,
    shifts: [{ clock_in_at: ago(600), clock_out_at: ago(75), worksite_id: 'w1' }] };
  db.gate = { gated: true, closed: !onShift, name: 'AASHISH', company: 'TAKEOFF', attendance: true };
  if (!onShift) { db.meSaved = db.me; db.me = null; }
  return db;
};
const page = async (db, width, where = HERE) => {
  const p = await phone(browser, db, { width }); await p.setViewportSize({ width, height: width < 900 ? 844 : 900 });
  await p.context().grantPermissions(['geolocation'], { origin: BASE }); await p.context().setGeolocation(where); return p;
};
const slide = async (p) => {
  const k = await (await p.$('.clk-knob')).boundingBox(), t = await (await p.$('.clk-slide')).boundingBox();
  await p.mouse.move(k.x + 20, k.y + 20); await p.mouse.down(); await p.mouse.move(t.x + t.width - 10, k.y + 20, { steps: 12 }); await p.mouse.up();
};
const shot = async (p, name) => { await p.screenshot({ path: path.join(dir, name + '.png') }); console.log('shot', name, JSON.stringify(p.__errors)); };
const menu = async (p) => { await p.evaluate(() => (document.querySelector('#cHead:not(.hidden)') || document.getElementById('menuBtn')).click()); await p.waitForSelector('#menu[open]'); await sleep(900); };
try {
  if (process.env.BAR) {
    for (const [onShift, name] of [[true, 'bar-on-shift'], [false, 'bar-clocked-in-needed']]) {
      const db = fixture('stdplus', true); db.aero.open = onShift ? db.aero.open : null; db.gate = { gated: false, closed: false, attendance: true };
      const p = await page(db, 390); await open(p); await sleep(1500); await shot(p, name);
      await p.click('#clockBtn'); await sleep(900); await shot(p, name + '-sheet');
      if (onShift) { await slide(p); await sleep(1800); await shot(p, name + '-after'); }
      await p.context().close();
    }
    process.exit(0);
  }
  for (const [theme, width] of [['ops', 390], ['stdplus', 390], ['premium', 390], ['', 360], ['ops', 1440]]) {
    const name = (theme || 'standard') + '-' + width;
    let db = fixture(theme, false), p = await page(db, width);
    await p.goto(BASE + '/'); await p.waitForSelector('.gatebox .clk-slide', { timeout: 8000 }); await sleep(900);
    await shot(p, 'clocked-out-' + name);
    if (theme === 'ops' && width === 390) {
      await slide(p); await sleep(400); await shot(p, 'clock-in-done-' + name);
      await sleep(3500); await shot(p, 'board-after-clock-in-' + name);
    }
    await p.context().close();
    if (theme === 'ops' && width === 390) {
      db = fixture(theme, false); p = await page(db, width, FAR);
      await p.goto(BASE + '/'); await p.waitForSelector('.gatebox .clk-slide'); await sleep(900); await shot(p, 'clocked-out-too-far-' + name); await p.context().close();
    }
    db = fixture(theme, true); p = await page(db, width); await open(p); await sleep(400); await menu(p);
    await shot(p, 'menu-on-shift-' + name);
    if (theme === 'ops' && width === 390) { await slide(p); await sleep(400); await shot(p, 'clock-out-done-' + name); await sleep(2500); await shot(p, 'after-clock-out-' + name); }
    await p.context().close();
  }
} finally { await browser.close(); server.close(); }
