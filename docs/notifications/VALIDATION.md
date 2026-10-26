# Validation — 26 October 2026

Base: `e8e0561dc6fcfea24669703183b28ba4d76f1e72`.
All mutation tests used disposable Postgres or fake APIs and fictional records.

| Check | Result |
|---|---|
| Notification database and access/lifecycle checks | 43 passed |
| Persistent push queue, ownership, expiry and retry checks | 25 passed |
| Actual sender with mocked push provider | 13 passed |
| Service worker routing, silence and subscription renewal | 9 passed |
| Notification browser acceptance, eight looks | 77 passed |
| Existing long-wait sender regression | 12 passed |
| Existing AT DESK sender regression | 10 passed |
| Existing health-alert sender regression | 11 passed |
| Existing call-permission database regression | 9 passed |
| Existing incoming-call browser regression | 93 passed, 0 failed |
| Generated bundle parity | Passed, 23 source parts |
| JavaScript syntax and patch whitespace | Passed |

The notification browser suite covers 390px in every look, 320px and desktop,
urgent/personal/resolved filters, per-user reads, acceptance, assignment, offline
controls, preference drafts, absent migration messaging, exact push and booking
links, escaping untrusted text, registered-device health and test targeting,
sign-out cleanup and discarding a late response after sign-out.

Local browser acceptance used Playwright 1.64.1 with Chromium 138.0.7204.0 supplied
through an isolated executable because the standard browser download was not
available here. The tests support normal Playwright Chromium via the documented
install command; that release-browser run remains Claude's responsibility.

The private-table and definer tests run on PGlite Postgres with the app's
me()/can() identity model and explicit role/permission fixtures. They verify the
SQL candidate, not the hosted Supabase project or its live migration history.
Security advisors and actual hosted API grants were not queried or changed.

No real push provider, handset, customer, supplier, Discord destination or phone
number was contacted by these tests. Real Android/iOS lock-screen display,
permission recovery, device battery restrictions and renewal remain internal
handset acceptance checks. No new native APK was built. No production-wide or
load-test/enterprise certification is claimed.

The ZIP's `previews/` are captures of the implemented web app using fictional
data and simulated device readiness. They are not screenshots of production.
