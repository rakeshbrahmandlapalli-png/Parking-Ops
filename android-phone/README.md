# TakeOff company phone

The Android app relays TakeOff customer texts through the company SIM, observes customer SMS replies and identifies incoming callers. It uses the existing TakeOff sign-in and has an explicit **Go online / Go offline** control. Use a dedicated company handset with its company SIM, power and internet available.

## Sending promptly

While online, a foreground remote-messaging service holds an authenticated Supabase Realtime connection. A new queued text wakes the sender without waiting for a 15-minute job. It also checks once a minute to recover missed events; a 15-minute WorkManager job is a final recovery mechanism. Reconnecting triggers a catch-up immediately.

The persistent Android notification shows whether the service is listening or reconnecting and includes **Go offline**. This is intended to send within seconds under healthy conditions; there is no guaranteed maximum delivery time. Android can suspend networking, the process can be stopped, and the carrier can delay SMS. Keep the office phone charging and allow background activity. After a reboot or Android's force-stop, open TakeOff and check the online status.

The web app's Customer texts settings show the paired phone's last check-in, battery, queue, failures and expired messages. A phone is offline after 90 seconds without a healthy check-in. This is a visible status, not an external paging service.

## Accurate outcomes and duplicate protection

- Only one handset and staff session are paired to send for a company. An owner must explicitly replace it. A previous handset cannot claim new messages after replacement; an already claimed message can still complete.
- Each claim has its own token. The handset saves its send journal before calling the modem.
- **Sending** waits for Android's sent callback for every SMS part. Returning from `SmsManager.sendTextMessage` does not mean success.
- **Sent** means Android confirmed every part was sent. **Delivered** requires carrier delivery reports for every part and does not mean read. Some networks do not provide delivery reports.
- Partial, missing or ambiguous results become **Check send outcome**. They are never automatically re-sent. Inspect the company phone/customer before a deliberate manual send. **Mark reviewed** records that check without sending anything.
- A callback arriving after a timeout can resolve uncertainty. Callback retries are idempotent.
- Database reports retry independently of modem sends, including after internet failure. Unacknowledged local observations survive process restart; completed send journals are retained up to seven days for late reports.
- Urgent/manual/test texts expire after 10 minutes, flight-landed texts after one hour and reminders after six hours. These expiry windows prevent a backlog from sending stale instructions after an outage. Queued automatic texts do not send while texts are switched off or in demo mode.

## Phone permissions and replies

Install directly on Android 10 or newer. Grant SMS sending/receiving, call log, phone state, notifications and (to identify callers saved in contacts) contacts permission. Select TakeOff as the call-screening app and select the company SIM as the default SMS SIM. The app does **not** need to replace the normal SMS app; the system SMS app keeps the inbox and ordinary notifications.

Only SMS observed on the default SMS subscription are relayed. Replies are durably queued on-device when offline and associated with an active matching booking server-side. General SMS that do not match a booking are not stored in the parking database. Reply matching is based on the active booking at sync time; exceptionally late replies can need manual review. Carrier-specific subscription extras and sideload permission behavior need validation on the target handset.

The native session is encrypted. Token refresh occurs only when needed or on HTTP 401 and is serialized across native workers. The WebView adopts updated native credentials and native sign-out stops new sends. Outstanding journal entries are company-scoped and are not uploaded after signing in to a different company.

## Calls and automated voice menus

Incoming cellular calls continue through the built-in phone app. The screening service promptly allows the call, matches the number and shows a notification. When Android reports the end of a call, a delayed reconciliation reads the completed call-log entry; a periodic check is a fallback. Zero-duration answered calls are not classified as missed. Use a company-only handset: call screening can observe calls on every active subscription.

A full automated voice menu needs a phone service that controls the voice media. The proposed flow is: company number → configured carrier forwarding or supported number port → voice service plays greeting and gathers 1/2 → validate an unambiguous active booking → write CALLED → ring staff inside the TakeOff app using a voice SDK. This would keep one installed app but introduces phone-service configuration and charges. It has not been implemented or enabled in this SIM bridge.

Do not forward the menu back to the same SIM number that forwards to the menu: that creates a loop. Use the in-app voice client or a separate staff destination. Configure fallback routing, no-input/invalid-input behavior, caller-ID preservation, busy/offline handling and emergency-call behavior before a pilot. Auto-answering a cellular call alone would not provide these functions, so the companion does not answer calls into silence.

## Build and local checks

Requirements: JDK 17, Android SDK 35, Build Tools 35.0.0. Use the Gradle wrapper (8.9) from this folder:

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

The app opens `https://takeoff-ops.vercel.app`; the public Supabase anon key and URL are in the app module configuration. No service-role or voice-provider secret is packaged. Debug signing is for development only; arrange a durable release signing key before distribution.

Database behavior tests use throwaway PGlite, with no live customer calls or SMS:

```sh
node checks/android-sim-bridge.mjs
node checks/customer-texts.mjs
```

These commands run from the repository root after installing `@electric-sql/pglite` in the Node module search path. `PGLITE_MODULE` can point to an external PGlite module for isolated tooling.

## Deployment order and acceptance

The prepared schema order is setup 116, 116b, 117, then 118. Deploy the matching `send-texts` function and web bundle before a handset pilot. None of those database or deployment actions have been performed in this branch.

Before a live release, validate on the actual company phone and SIM: locked screen, battery restrictions, airplane-mode recovery, reboot, multi-part SMS success/failure, carrier delivery reports, offline replies, zero-duration answered/missed/rejected calls, app sign-out, phone replacement and company isolation. Measure actual queue-to-send time. Source checks and a debug APK build do not establish carrier/device reliability.

## Local verification — 24 October 2026

The debug APK assembled successfully with the checked-in Gradle wrapper configuration, JDK 17 and SDK 35. All 24 SIM-bridge database checks, 39 customer-text checks and eight native SMS-result unit tests passed. The generated web bundle matched its sources; web/Edge Function syntax checks passed.

Android lint completed with zero errors and 21 warnings: deliberately synchronous durable preference writes, English UI strings, JavaScript required by the trusted web app and the existing square launcher artwork. These were not hidden with a lint baseline. Real handset/carrier testing and an end-to-end pilot remain outstanding; no production schema or deployment was changed.

The phone parts were renumbered on 24 October to avoid the already merged/applied `114-move-pick-same-time.sql` desk-booking fix on main `f6633eb`. Parts 116/116b/117/118 are the prepared phone feature; do not reapply the old part numbers from Claude’s abandoned feature branch.

Handoff verification after combining the newer main desk-booking fix: the focused real-web-app browser suites passed 99 text checks and 77 call checks with a mocked backend. Preview screenshots use fabricated booking data; the separate native wrapper picture is a labelled layout mockup. The deployed handset/carrier flow remains untested.
