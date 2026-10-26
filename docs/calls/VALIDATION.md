# Validation — 26 October 2026

Prepared on main ff90cbe76451f10be438e22cae3cab5d8ecea458. All tests used disposable data; no live database, customer or phone call was changed.

| Check | Result |
|---|---|
| Database workflow (real SQL on PGlite) | 14 passed |
| Focused browser workflow | 15 scenarios passed |
| Existing call browser regression | 96 passed, 0 failed |
| Existing notification database regression | 43 passed |
| Existing notification push queue regression | 25 passed |
| Existing notification delivery regression | 14 passed |
| Existing service worker regression | 9 passed |
| Built app matches its source parts | Passed |
| JavaScript syntax and whitespace checks | Passed |

Focused browser tests cover 320,390,768,900,1024,1440px, plus all eight themes. They exercise claims, failed claims, no answer, retry, resolving, owner-only controls, hidden numbers, more than three calls, wrong-company events, escaped caller text, minimising and queue recovery after refresh. Desktop checks verify the dock reserves board space and that action buttons can be reached by scrolling the board. A clipping problem caused by content-visibility on the existing desktop rows was found and fixed with explicit scrollable widths and synchronised column heading scrolling while docked.

SQL checks cover repeat schema application, legacy history, all outstanding calls across midnight, recent resolution of an older call, idempotent claims, competing owners, callbacks requiring claims, tenant/permission denial, add-on-off denial, anonymous grants and private-helper restrictions. Claiming and dialler attempts do not resolve the existing notification. Explicit resolution updates only its matching call inbox entry.

The focused browser tests use mock API responses; SQL tests execute the real schema separately. Row locks are present in both mutating RPCs; a production concurrent-session test remains part of release verification. No handset dialler, Android/SIM or live Supabase smoke test was performed. The retry due indicator is visual and does not schedule a new reminder push.

Browser: Chromium 138.0.7204.0 with the repository Playwright harness. The download of its default Chromium build failed; an available local Chromium executable was used successfully via CHROMIUM. To reproduce, supply any compatible installed Chromium path as documented.

No deployment, hosted migration, edge-function release, telephony configuration change or main-branch push was performed.
