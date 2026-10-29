// Each section gets a fresh Chromium process. No live services are used.
import { readdirSync } from 'node:fs';
import { fork } from 'node:child_process';

if (!process.env.E2E_SECTION && !process.env.STRESS && !process.env.SHOTS) {
  const allSections = readdirSync(new URL('./sections/', import.meta.url)).filter(f => /^\d\d-.+\.mjs$/.test(f)).sort();
  // The 250ms tap benchmark must not compete with another browser section.
  const performanceSections = allSections.filter(file => file === '07-office-and-key-check.mjs');
  const sections = allSections.filter(file => !performanceSections.includes(file));
  let passed = 0, failed = 0;
  const active = new Set();
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    console.error(`Regression run interrupted by ${signal}; incomplete run is a failure.`);
    for (const child of active) child.kill(signal);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
  // Bounded parallelism keeps memory use predictable without one global timeout.
  async function worker(queue = sections) {
    while (queue.length) {
      const section = queue.shift();
      await new Promise(resolve => {
        console.log(`\nSECTION ${section}`);
        const child = fork(new URL('./run.mjs', import.meta.url), [], { env: { ...process.env, E2E_SECTION: section }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        active.add(child);
        let result;
        child.on('message', message => { if (message.type === 'summary') result = message; });
        child.on('error', error => console.error(`${section}: ${error.message}`));
        child.on('exit', (code, signal) => {
          active.delete(child);
          if (result) { passed += result.passed; failed += result.failed; }
          if (!result || signal || (code !== 0 && !result.failed)) {
            failed++;
            console.error(`FAIL ${section}: incomplete browser run (exit=${code}, signal=${signal}, summary=${!!result})`);
          }
          resolve();
        });
      });
    }
  }
  await Promise.all([worker(), worker()]);
  await worker(performanceSections);
  console.log(`\nTOTAL ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
} else {
  const h = await import('./harness.mjs');
  try {
    if (process.env.SHOTS) await (await import('./previews.mjs')).shots(process.env.SHOTS);
    else if (process.env.STRESS) await (await import('./stress.mjs')).stressTests();
    else {
      if (!/^\d\d-[\w-]+\.mjs$/.test(process.env.E2E_SECTION)) throw new Error('Invalid section');
      await import('./sections/' + process.env.E2E_SECTION);
    }
    h.check('the security policy blocked nothing the app needs', h.cspBlocked.length === 0, h.cspBlocked.slice(0, 3));
  } catch (error) {
    h.check('browser section completed', false, String(error.stack || error));
  } finally {
    await h.browser.close();
    h.server.close();
  }
  console.log(`\n${process.env.E2E_SECTION || 'special'}: ${h.passed} passed, ${h.failed} failed`);
  if (process.send) await new Promise(resolve => process.send({ type: 'summary', passed: h.passed, failed: h.failed }, resolve));
  process.exit(h.failed ? 1 : 0);
}
