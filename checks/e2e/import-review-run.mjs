// Focused browser checks for reviewed imports. Uses the isolated harness only.
import {browser,server,passed,failed,check} from './harness.mjs';
await import('./sections/12-import-review.mjs');
check('browser import checks finished',true);
await browser.close();server.close();console.log(`${passed} passed, ${failed} failed`);process.exit(failed?1:0);
