# TakeOff company phone

The Android app relays TakeOff customer texts through the company SIM, observes customer SMS replies and identifies incoming callers. It uses the existing TakeOff sign-in and has an explicit **Go online / Go offline** control. Use a dedicated company handset with its company SIM, power and internet available.

## Sending promptly

While online, a foreground remote-messaging service holds an authenticated Supabase Realtime connection. A new queued text wakes the sender without waiting for a 15-minute job. It also checks once a minute to recover missed events; a 15-minute WorkManager job is a final recovery mechanism. Reconnecting triggers a catch-up immediately.

The persistent Android notification shows whether the service is listening or reconnecting and includes **Go offline**. This is intended to send within seconds under healthy conditions; there is no guaranteed maximum delivery time. Android can suspend networking, the process can be stopped, and the carrier can delay SMS. Keep the office phone charging and allow background activity. After a reboot or Android's force-stop, open TakeOff and check the online status.

The web app's Customer texts settings show the paired phone's last check-in, battery, queue, failures and expired messages. A phone is offline after 90 seconds without a healthy check-in. This is a visible status, not an external paging service.

## Accurate outcomes and duplicate protection

- Only one handset and staff session are paired to send for a company. An owner signed in on the handset pairs it at once (or replaces the old one deliberately). Any other login, normally the office login, only asks: the owner approves or refuses it in Settings → Customer texts → Company phone, which names the login and warns if the phone is on an owner login. Unpair stops it claiming texts. A switched-off staff login can't be approved, and its session no longer claims. A previous handset cannot claim new messages after replacement; an already claimed message can still complete.
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

The app opens `https://takeoff-ops.vercel.app`; the public Supabase anon key and URL are in the app module configuration. No service-role or voice-provider secret is packaged. Release builds are signed from environment variables, never from files in the repo:

```sh
TAKEOFF_KEYSTORE=/path/to/takeoff-phone-release.p12 TAKEOFF_KEYSTORE_PASSWORD=… TAKEOFF_KEY_PASSWORD=… \
  ./gradlew :app:assembleRelease
```

The alias defaults to `takeoff-phone`. Every update must be signed with the same key, or Android refuses to install it over the old app. Release certificate SHA-256: `29:9B:09:EB:0B:9C:54:34:F0:28:28:95:E1:B4:DF:2A:79:47:26:32:B5:84:58:05:F9:33:29:F7:82:DD:36:55`. Keep the keystore and its password in the owner's password manager or another durable secret store, never in the repo or chat. The built APK is published at `https://takeoff-ops.vercel.app/phone/takeoff-phone.apk` (served as an attachment, not cached by the web app's offline cache) with its SHA-256 beside it in `takeoff-phone.apk.sha256`.

Database behavior tests use throwaway PGlite, with no live customer calls or SMS:

```sh
node checks/android-sim-bridge.mjs
node checks/customer-texts.mjs
```

These commands run from the repository root after installing `@electric-sql/pglite` in the Node module search path. `PGLITE_MODULE` can point to an external PGlite module for isolated tooling.

## Deployment state (24 October 2026)

Live on the Ops database: setup 116, 116b, 117, 118 and 118b, applied in that order by Claude at the owner's request; `send-texts` v1 deployed with verify_jwt off (each route checks the timer secret or the caller's sign-in). The Twilio `calls` function is not deployed. Pilot: only TakeOff has the Customer texts and Calls add-ons. Automatic texts stay off until the handset tests below pass; an owner's Settings test text can be queued while they are off.

Automatic DROPS events (flight landed, SENT) are written to `private.text_outbox` in the same transaction as the booking change. The trigger nudges `send-texts` at once and the `customer-text-outbox` timer retries every minute (up to 10 tries or one hour). Each booking and rule is queued once, so a retry never makes a second text.

## Handset acceptance (still to do)

Validate on the actual company phone and SIM: locked screen, battery restrictions, airplane-mode recovery, reboot, multi-part SMS success/failure, carrier delivery reports, offline replies, zero-duration answered/missed/rejected calls, app sign-out, phone replacement and company isolation. Measure queue-to-send time. Source checks and an APK build do not establish carrier/device reliability, and none of these have been done yet.

## Local verification — 24 October 2026

Release and debug APKs assembled with the Gradle 8.9 wrapper, JDK 21 and SDK 35; the release APK verifies with the v2 signature scheme. 38 SIM-bridge database checks (pairing request/approve/refuse/unpair, switched-off login, ambiguous reply and call, outbox), the customer-text and incoming-call schema checks, and eight native SMS-result unit tests passed. Browser suites: TEXTS_ONLY 106 passed, CALLS_ONLY 78 passed. Android lint: 0 errors; warnings are synchronous durable preference writes, dependency versions, the launcher artwork and JavaScript required by the trusted web app.

The phone parts were renumbered twice on 24 October: main had already used 114 (move pick same time) and 115 (AT DESK access). The parts are 116/116b (texts), 117 (calls schema), 118/118b (SIM bridge, pairing, outbox). Do not apply older numbers from abandoned branches.
