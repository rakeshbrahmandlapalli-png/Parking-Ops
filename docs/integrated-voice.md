# TakeOff caller menu and calls inside the company app

Review build against main `1e52c124aaaab7c5464deb866be3914727bf2c98`.
Prepared on 25 October 2026. Nothing has been applied or activated live.
Android version is 0.3.0 / code 5, following the existing 0.2.2 / code 4.

## What the customer and office get

A customer calls the usual company number. After separately approved call
forwarding, a hosted voice service answers, speaks the welcome and offers:

- **1 — landed:** mark CALLED on one matching, uncleared DROPS booking for the current operational night.
- **2 — dropping off:** mark CALLED on one matching, not-yet-taken-in PICKS booking for the local calendar day.
- **0 — office:** connect without changing a booking.

After a selection, the company phone rings **inside TakeOff**, showing the
registration, customer and choice when matched. Staff tap Answer, talk, mute,
use speaker/headset, end the call or open the board without installing a second
app. A server permission check runs again before accepting audio. Call status,
choice and duration use the existing Calls page and booking call history.

No key connects to staff after six seconds following the prompt. An invalid
key gets one retry, then connects to staff. App ringing lasts up to 25 seconds;
an explicitly configured, separate fallback number gets one 20-second attempt.
Otherwise the caller hears that the office is unavailable. Staff are not
reported as having answered just because the automated greeting played.

Unknown, withheld, international and ambiguous numbers are left for the office;
no car is guessed. Automatic matching currently supports UK +44 caller IDs and
the existing UK booking-number normalization. Repeat callbacks cannot mark a
second booking or switch the original choice. A custom greeting is a welcome;
the 1 / 2 / 0 instructions are always appended.

## One app, with a hosted telephone service

The existing Android SIM/SMS bridge stays in the same application. Texts still
come from that SIM and its plan. The voice menu and call audio use a provider
behind the scenes, with Firebase push delivery to the same app. No MacroDroid,
SMS Gateway or separate softphone is required.

This is **not a free production voice service**. Provider number rental, inbound
and app call legs, and any carrier forwarding can incur costs. Server hosting,
plan limits and taxes may also apply. A free trial is not a free production plan.
Quote the actual account/country/carrier charges before asking for activation.

A standard Android app cannot reliably inject a recording into an ordinary SIM
call and receive the caller's keypad as an IVR. This implementation answers the
call at the provider and delivers the conversation as an internet call in
TakeOff. It needs internet and Google Play services/FCM on the handset. The app
still uses Android Telecom to respect other calls. It does not auto-answer the
staff microphone: the **provider** auto-answers the customer, and a person taps
Answer to talk.

## Keep activation separate from review

The migration creates no provider route, buys no number, changes no forwarding
and enables nothing. A default build has blank public Firebase configuration,
so the current SIM feature works without initializing Firebase. There is no APK
in the handoff: a release update must use the existing production signing key.
Do not uninstall the existing app or replace it with a debug-signed build.

Before activation, obtain the owner's explicit approval for the exact provider
costs and the forwarding change. Until then, leave `approved_at` null, `menu_on`
false and all production forwarding unchanged. Never populate approval simply
to make a setup screen turn green.

## Integration sequence for Claude / maintainer

1. Review and apply the supplied patch on an isolated branch. If main has moved,
   port carefully and retain the latest handset/SIM/auth fixes. Reserve a new SQL
   part if 120 is already used; update both the canonical and migration copies,
   test path and this document together. Adjust Android version above any newer
   release. Do not reset another branch or replace unrelated migrations.
2. Review SQL and Edge Functions, run the local checks below and show the owner
   previews. Do not merge, deploy, apply production SQL or change provider/carrier
   settings as part of the patch review.
3. When separately authorized to release, apply **one copy only** of
   `setup/120-integrated-voice.sql` or the matching CLI migration. Parts through
   119 must already be applied. The migration file is an exact mirror for review,
   not a second migration to apply after manual SQL. There is no instruction here
   to run all historical migrations against production.
4. Configure server credentials securely using the provider/Supabase secret
   tools, never in chat, source, APK, screenshots or the patch:
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`,
   `TWILIO_API_KEY_SECRET`, `TWILIO_PUSH_CREDENTIAL_SID`, `VOICE_WEBHOOK_URL`.
   Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`. The current adapter supports one provider account
   per deployed pair of functions; other accounts require isolated functions or
   an account-aware secret lookup, not merely a second route row.
5. `VOICE_WEBHOOK_URL` must be the exact public HTTPS URL of `voice-menu`, with no
   query string. The provider's phone-number voice webhook uses this URL, POST.
   Its parent status callback must use the same URL plus `?step=parent-status`,
   POST. Configure a provider error fallback that does not call back into the
   forwarded company SIM; backend errors intentionally return 503. Check signed
   URL validation through the deployed gateway before a pilot.
6. Deploy `voice-menu` with platform JWT verification OFF, as specified in
   `supabase/config.toml`; it checks the Twilio signature itself before any RPC.
   Keep `voice-access` JWT verification ON. Only deploy these named functions.
   If the real repository already has a config, merge these entries into it.
7. Set up Firebase for Android package `uk.co.takeoffops.phone`. Configure the
   current Twilio **FCM HTTP v1** push credential using the matching Firebase
   service-account credential through the provider's secure console. Do not use
   old legacy FCM server-key instructions. Keep its private JSON outside the
   repository and APK. Enable the required Cloud Messaging API. Match the
   production app/signing configuration and public API-key application limits.
8. The APK builder needs only the public Firebase app configuration through env:
   `VOICE_FCM_APP_ID`, `VOICE_FCM_API_KEY`, `VOICE_FCM_PROJECT_ID`,
   `VOICE_FCM_SENDER_ID`. These are the public values from the Firebase Android
   configuration, not a service-account key. Initialization is explicit; this
   implementation does not require the google-services Gradle plugin or a
   checked-in google-services.json. Build using the existing external release
   signing environment documented in android-phone/README.md. Verify the
   certificate is the existing production certificate before distributing.
9. After cost approval and authorized provider setup, a privileged operator adds
   the company's row in **private.voice_routes**: company UUID, provider Account
   SID, owned provider inbound number, actual company number and optional
   fallback in E.164. Set `approved_at` only to record actual consent. Leave the
   menu off until the handset is registered. The fallback must be independently
   reachable and not forwarded to the provider. SQL rejects equality with the
   company or inbound number; it cannot detect an indirect carrier forwarding
   loop. Verify that manually. Never forward the provider leg back to the same
   forwarded company SIM.
10. On the same approved company handset/login: Go online, open Voice calls,
    allow microphone, call notification and optional Bluetooth permissions, then
    Enable/retry. The app registers an incoming-only, company/device identity;
    the server checks the current approved pairing and staff permissions.
    Settings -> Calls shows readiness only with a fresh company-phone heartbeat
    and a current voice registration. Owners can then save a welcome and turn
    on the keypad menu. Live forwarding must still wait for its separate approval
    and the pilot below. Test initially by directly dialing the provider number.

`menu_on=false` skips the keypad menu and still rings the app when calls are
routed to the provider. Turning the menu off does **not** stop provider charges
or undo carrier forwarding. Turning Calls in the app off refuses new voice
routing. To restore direct SIM answering, separately authorize and reverse the
carrier forwarding, then disable the provider route. Preserve the SIM/SMS setup.

## Security and behavior checks

Provider routes, devices and sessions are private with RLS and no app-table
access. Webhooks are HMAC authenticated, bound to a fixed external URL and
mapped to a company from provider account + inbound number. Privileged hooks
are service-role only. The staff token endpoint checks JWT, current staff
permission and the approved device. Tokens last ten minutes and allow incoming
calls only. The native app validates invite recipient identity as well, so an
old push binding cannot cross company/device sign-in changes. It rechecks live
server access immediately before accepting. Going offline declines pending
calls; an existing conversation can finish. Signing out ends the conversation.

Registration refreshes every six hours while online, with a 24-hour server
lease and three-minute retry backoff. Calls are routed only while the existing
company-phone heartbeat is ready and less than 90 seconds old. Network loss,
battery restrictions, force-stop, FCM problems or revoked permissions can still
prevent ringing. The approved fallback/unavailable path handles that; a real
pilot is required. Full-screen ringing depends on Android's user/system access;
a call notification is used when full-screen access is unavailable.

The local implementation has no provider purchase API, no recording feature,
no outgoing SDK grant, and no automatically changed carrier settings.

## Local validation

- `node checks/voice-menu.mjs` — signed webhook, XML, menu retries, callbacks,
  fallback, incoming-only token, custom greeting.
- `node checks/voice-database.mjs` — install `@electric-sql/pglite` in a temporary
  tool directory; optionally set `PGLITE_MODULE` to its absolute dist/index.js.
  Disposable PostgreSQL tests; uses the shipped part118 phone-matching helper.
- `node checks/android-sim-bridge.mjs` — same PGlite option; SIM regression.
- `node src/build.mjs --check` and `node --check public/app.js`.
- `VOICE_SHOTS=/absolute/output node checks/e2e/voice-menu-review.mjs` after the
  repository's normal Playwright setup, optionally `CHROMIUM=/path/to/chrome`.
  This captures actual web UI using **synthetic data and mocked RPCs**.
- `CALLS_ONLY=1 node checks/e2e/run.mjs` — existing Calls regression across looks.
- `deno check supabase/functions/voice-menu/index.ts supabase/functions/voice-access/index.ts`.
- From android-phone: Gradle 8.9, JDK17, Android SDK35:
  `gradle :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`.
  A compile success/default build does not exercise live push or audio.

## Mandatory pilot before public forwarding

On the actual Samsung/company handset and a second caller phone, verify:

- Customer presses 1/2/0, no key, invalid key, repeat callback and hangup during
  greeting; correct booking/day and a single CALLED audit, no incorrect marks.
- Duplicate/unknown/withheld caller numbers; ask staff to identify the booking.
- Ringing/Answer/Decline while app open, backgrounded, screen locked and after
  normal process recreation; permitted full-screen versus notification behavior.
- Two-way audio, microphone mute, speaker, wired/Bluetooth headsets, proximity
  and screen behavior; another cellular/VoIP call in progress and a second caller.
- Network loss and recovery during ringing/conversation, offline handset,
  permission revocation, device replacement, sign-out and expired staff access.
- Approved fallback and unavailable message; answered/missed status and duration
  on the Calls page, parent versus child callback order, backend outage handling.
- Existing SIM SMS, replies, original caller ID/call log and durable send journal
  after installing the correctly signed update. Check forwarded carrier call-log
  records do not create confusing duplicate office call entries on this handset.
- Actual account billing and forwarding charges, and a tested carrier rollback.

No provider/FCM/carrier/handset end-to-end testing has been performed in this
workspace. Do not describe the release as live, perfect or fully phone-tested.

## Review notes (25 Oct 2026)
- `supabase/config.toml` now lists every function with its live `verify_jwt` setting, so a CLI deploy cannot switch JWT checking on for the existing functions.
- Going offline captures the phone's credentials first and sends "offline" to `voice-access` even after sign-out wipes them. If that token has already expired the call fails quietly; the route still stops within 90 s because it needs a fresh phone heartbeat.
- Provider signatures carry no timestamp, so a captured webhook cannot be told apart by age. Call-id checks, one choice per call and the 24-hour session rule limit what a replay can do.
