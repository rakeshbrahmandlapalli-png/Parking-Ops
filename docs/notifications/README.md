# Notification centre and push improvements

Prepared 26 October 2026 for `rakeshbrahmandlapalli-png/takeoff-ops`.
Base: `e8e0561dc6fcfea24669703183b28ba4d76f1e72`.
Status: local implementation and review package. No production database, function,
website, staff access, Discord channel, customer message or phone setting was changed.

## What is implemented

- A header bell and menu entry in every existing look. An unread count, urgent,
  personal and resolved filters, real booking links and a seven-day inbox. Up to
  200 entries are returned, prioritising unresolved and urgent work.
- Shared acceptance, dispatch assignment, release, personal read state and an
  activity timeline. These are server-confirmed operations with a locked row;
  two people cannot both accept an unassigned task. Accepting does not mark SENT
  or RTC. Existing booking workflows retain those meanings.
- CALLED, AT DESK and the later long-wait update share one collection task per
  call cycle. The existing phone alerts for those events remain distinct.
  The person creating a booking event can see it in the inbox but still does
  not receive their own push.
- Inbox entries for existing RTC, cancelled-flight, complaint, incoming-call,
  import-held, usage and health alerts, delivered to the existing recipients.
  Call history remains subject to the Calls add-on and Call pop-ups permission.
  The platform login continues to use Clients/Health for system warnings.
- Five-minute timer checks for keys explicitly marked **missing** in an active
  shared check, and physical lane blockages within 30 minutes either side of the
  booked return. Unchecked keys are not treated as missing. Both-end lanes are
  blocked only when cars occupy both exit directions. Yard alerts go to active
  staff with yard permission; lane alerts require the lane-planner add-on.
- Unaccepted urgent collection/RTC/key/lane tasks escalate to supervisors on
  the first timer run after five minutes. Escalation means a supervisor alert,
  not a promise that a person has read it. Accepted tasks do not escalate.
- Resolution follows current bookings, shared checks and recorded positions.
  Removed/expired work closes automatically. Inbox storage is retained for
  30 days; the UI shows seven days. Push attempt storage is retained for seven.

## Push work included

- A persistent queue per subscription, idempotent event keys and leased attempts.
  Temporary network/provider failures, HTTP 408 and 429 can retry; other 4xx
  errors fail. A request has a 15-second socket timeout. There are at most five
  attempts with exponential backoff, retried by the existing five-minute timer.
- Provider acceptance is recorded separately from delivery. The UI shows
  queued attempts, failures in 24 hours and last provider acceptance for the
  current device. It never invents a displayed/delivered receipt.
- Every retry rechecks active access, subscription ownership, alert preferences,
  pause state, completed work and answered/claimed calls. A subscription moved
  to another person cannot receive the previous person's queued messages.
  HTTP 404/410 removes an expired subscription and its queued messages.
- A test targets the current device and works even with DROPS alerts switched
  off. It bypasses a temporary pause. Server registration is checked as well as
  the local browser subscription before the UI says it is registered.
- Provider topics coalesce offline updates for the same booking; device tags
  replace visible duplicates without requesting a repeat sound. TTL: incoming
  calls 3 minutes; tests 1 minute; urgent work 10 minutes; routine work 30 minutes;
  usage/health 2 hours. A provider may already hold an alert when a task resolves;
  its TTL bounds that case and opening it shows the current state.
- Silent routine pushes and 1-hour/8-hour pauses, with immediate resume. Inbox
  entries continue during a pause; usage/health warnings still push. Devices
  control actual sound and Do Not Disturb. Silence does not promise urgency
  bypass on an operating system.
- A subscription-change handler attempts renewal using the existing public key.
  Only an active signed-in app saves the renewed subscription. No auth token is
  put in the service worker. Existing granted subscriptions sync on sign-in.
- Clicking a push opens the correct inbox entry after sign-in. An existing app
  receives a message instead of being forcibly navigated, preserving its token
  and booking editor. Cross-origin and non-app destinations are rejected.
- Sign-out clears the new in-memory inbox, DOM and badge. Late results cannot
  reopen it. No inbox data is written to localStorage or the offline save queue.

## Release files and order

`Takeoff_Notifications.patch` is generated against the base above, including
new source, generated bundle, styles, service worker, Edge Function and tests.
`source-files/` in the ZIP contains just the changed/new files for manual
reconciliation, not a replacement repository.

1. Compare with current main and newer Claude work. Apply with `git apply --check`
   first; reconcile changed source instead of overwriting newer files. Edit
   `src/app/` and regenerate `public/app.js`.
2. Inspect the actual hosted schema and existing five-minute long-wait cron.
   Required existing parts are 93 (shared keys), 104 (lanes), 123 (call alerts),
   plus their existing prerequisites. Do not assume CLAUDE.md proves live state.
3. Create the next real migration with the Supabase CLI. Copy **schema.sql then
   push-schema.sql**, in that order, into the reviewed migration. The files here
   are candidate SQL, not a claim that a hosted migration ran. Run both in a
   disposable database/staging environment and run security advisors.
4. Apply that migration, then deploy the changed `send-alerts` function, retaining
   the existing JWT verification mode and all existing VAPID/timer secrets. The
   trigger/timer routes retain their existing validations. No new cron is added.
   The previous function continues to work with the additive schema.
5. Deploy the frontend and verify `/notifications.css`, bundle parity and the
   updated service worker cache version. The new code falls back to existing
   push sending if optional queue RPCs are unavailable, and explains an absent
   inbox migration instead of inventing history.
6. Use a dedicated synthetic tenant to test permission changes, two operators,
   real browser push, locked screen, no signal, pause/resume and shared-device
   sign-out. Do not create disposable records or messages for live customers.

## Repeatable validation

Node 24+; dependencies live only under `checks/` so hosting build detection is
unchanged. Versions are pinned in the test-only manifest and lockfile.

```sh
npm --prefix checks ci
npx --prefix checks playwright install chromium
node src/build.mjs --check
node --check public/app.js
node --check public/sw.js
npm --prefix checks run check:notifications
npm --prefix checks run check:notification-browser
node checks/long-wait-alert.mjs
node checks/at-desk-alert.mjs
node checks/health-alerts.mjs
node checks/call-popups.mjs
CALLS_ONLY=1 node checks/e2e/run.mjs
```

If Chromium is already installed, set `CHROMIUM` to its executable. Optional
`NOTIFICATION_SHOTS=/absolute/directory` saves fictional-data interface previews.
The queue's database tests cover duplicate enqueues, leases, backoff, permanent
errors, maximum attempts, stale responses, expired work, changed permissions,
shared-phone reassignment and provider acceptance without calling a provider.

## Boundaries

- This is not a full-app enterprise sign-off. The rest of the application and
  production load were not re-audited. See VALIDATION.md for exact test scope.
- Attendance/shift scheduling is not linked. Explicit timed pauses are provided
  instead of a switch that would imply an unavailable shift integration.
- The flight alert remains **cancelled flights**, not every arrival-time change.
  No new payment notifications or payment-access changes were added.
- The queue protects attempts after an event is enqueued. Existing database
  trigger-to-function generation and `alert_log` are not replaced by a general
  transactional event outbox. Missing infrastructure or a failed enqueue can
  still require investigation; logs identify fallback to legacy delivery.
- The schedule must actually run. Retry/backoff and escalation occur on timer
  ticks, not exactly on a minute boundary. It can take 5–10 minutes for the first
  five-minute escalation depending on the timer phase.
- Web Push supports the existing Chrome/PWA path and installed iOS Home Screen
  apps where supported. No native Android WebView push/FCM implementation or APK
  was added. Native voice push and company-SIM call/text handling are unchanged.
- Real handset delivery, sounds, battery restrictions and iOS/Android background
  behaviour remain acceptance checks for release, not simulated guarantees.

## Rollback

Restore the pre-release frontend/service worker and `send-alerts` function from
the recorded release baseline. Leave the additive tables intact to preserve
history. The existing cron then resumes its original function behaviour, so no
timer needs deleting. The candidate `rollback-access.sql` can revoke access to
the new public APIs once the old app/function are restored. Do not drop existing
push subscriptions, alert preferences, alert logs or any booking tables.

Primary documentation checked:
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://github.com/web-push-libs/web-push (timeouts, TTL, urgency and topics)
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
