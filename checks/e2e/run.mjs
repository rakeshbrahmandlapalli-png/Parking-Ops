// TAKEOFF OPS — browser tests: the real app (public/) in Chromium, phone-sized,
// against a pretend Supabase that behaves like the real one and records every
// call. Nothing touches the live database.
//
//   cd checks/e2e && npm install playwright@1 && node run.mjs
//   (Chromium: set CHROMIUM=/path/to/chrome if Playwright's own isn't installed)
//
// Every line prints PASS or FAIL; the run ends with the totals and exits 1 on
// any failure. Run it before merging a change to public/.
//
// The sections live in checks/e2e/sections (run in file-name order), the shared
// server, pretend Supabase and helpers in harness.mjs, STRESS=1 in stress.mjs and
// SHOTS=dir in previews.mjs.
import { fs, passed, check, cspBlocked, server, browser, failed } from "./harness.mjs";
import { stressTests } from "./stress.mjs";
import { shots } from "./previews.mjs";

// STRESS=1 node run.mjs: only the stress tests (big sheets on a slow phone, bad
// signal, big imports), in stress.mjs. The normal run skips them.
// SHOTS=dir node run.mjs: only screenshots of the Operations look (SHOTS_THEME=stdplus for another), for previews.
if (process.env.SHOTS) { await shots(process.env.SHOTS); await browser.close(); server.close(); process.exit(0); }
if (process.env.STRESS) { await stressTests(); await browser.close(); server.close(); console.log("\n" + passed + " passed, " + failed + " failed"); process.exit(failed ? 1 : 0); }

for (const f of fs.readdirSync(new URL("./sections/", import.meta.url)).filter((f) => /^\d\d-.+\.mjs$/.test(f)).sort()) await import("./sections/" + f);

check("the security policy blocked nothing the app needs", cspBlocked.length === 0, cspBlocked.slice(0, 3));
await browser.close(); server.close();
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
