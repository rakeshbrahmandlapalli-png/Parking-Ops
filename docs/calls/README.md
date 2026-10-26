# Responsive company call queue

Prepared against `rakeshbrahmandlapalli-png/takeoff-ops` main `ff90cbe76451f10be438e22cae3cab5d8ecea458`, which includes the completed notification centre and send-alerts v31 release.

## Behaviour

- PC (900px+): a dock on the right reserves space beside the app. The board stays available, with horizontal scrolling on smaller desktop widths when its columns need it.
- Mobile: a bottom sheet with at least 44px action targets; a compact banner remains after minimising. The queue can be reopened, browsed with Previous/Next or its call list, and dismissed with Escape. New calls do not steal keyboard focus.
- Incoming call: masked phone, matched registration/customer, real return/status/yard/key tag, existing CALLED and AT DESK booking actions. No invented lane or retrieval position. Booking actions are explicitly separate from callback outcomes.
- Missed call: Claim callback → Call customer → No answer / Try in 15 min / Resolved. A claim does not mean the customer was called; opening the dialler records only a requested attempt. The system cannot determine whether the dialler actually placed a call.
- Server-enforced ownership: row locks and company/permission checks; another staff login cannot claim or resolve your call. Claim owner can release; managers/owners can release another claim. Ownership is by staff login; people sharing one login share that identity, with the acting display name retained in audit history.
- Outstanding missed calls survive closing, refresh and midnight; the old three-popup truncation is removed. Feed recovers on app start, Realtime reconnection and every 45 seconds while visible. Claim/outcome updates also arrive over existing Realtime.
- History retains resolved actor/time, plus recent answered calls. Pre-existing handled missed calls are labelled “Previously handled · outcome not recorded”, rather than inventing successful outcomes or reopening every historical callback.
- No answer remains outstanding. Try in 15 min stores a server-computed due time; the card shows “Retry due” once it passes. Unclaimed missed calls show overdue at five minutes. These are visual indicators, not a new scheduled push-reminder system.
- Repeat callers show a count while retaining separate call records. Unknown/hidden callers remain reviewable; no booking is guessed.
- A confirmed resolution updates the matching existing call notification. No new notification channel, Android changes, provider changes, forwarding, auto-answer, voice costs or edge-function deployment is required.
- `callpop` permission and Calls add-on remain the gates. Users granted callpop can open the Calls page. Claims are never written to the offline booking queue. If the schema is absent, call workflow writes stay disabled with an explanatory message; existing booking actions remain.

## Files

Edit `src/app/16-texts-calls.js`, not the bundled app. CSS is scoped to the call surface and the active desktop dock; it does not replace any theme stylesheet. `public/app.js` is rebuilt. `public/calls.css` is linked and cached; service worker cache is v15.

`setup/126-call-queue.sql` (part 126) is the reviewed database payload, not an applied migration. Deployment owner should create a migration with the Supabase CLI, apply the payload after part 125, run advisors and verify it, then deploy the frontend. It adds callback columns and three RPCs, and wraps old `call_take` so old frontends cannot steal claims or log false callback success. Keep the columns/history on a frontend rollback. No hosted change has been performed.

## Checks

```sh
npm --prefix checks ci
node src/build.mjs --check
node --check public/app.js
node checks/call-workflow.mjs
CHROMIUM=/path/to/chromium node checks/e2e/call-queue-review.mjs
CALLS_ONLY=1 CHROMIUM=/path/to/chromium node checks/e2e/run.mjs
npm --prefix checks run check:notifications
```

Set `CALL_QUEUE_SHOTS=/absolute/path` for synthetic preview captures during the focused browser review. The browser fixture tests actual shipped HTML/JS/CSS against mock API responses; the separate PGlite test executes the database SQL. No hosted database, SIM or voice-provider call was tested. Do a two-staff live smoke test after applying the schema: one incoming company call, let it be missed, claim from one login, verify another login is blocked, record no answer and retry, then resolve and refresh.
