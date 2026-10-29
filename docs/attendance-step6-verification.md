# Step 6 automated acceptance passed — release remains blocked

Verification completed on 28 October 2026. This report supersedes the automated
blockers in `attendance-step6-checkpoint.md`. It is not production approval.

Tested Parking runtime/check commit: `c3fc7de18d810e4c8630aaaa8b6bc8045a2d60ef`.
Aero check/documentation head: `d0da7b2b0ac9c57cf48eef481a05a41e8da17a2e`.
The final Parking PR head also includes this separate report commit.

## Fixes and evidence

- A dashboard-local `var sb` shadowed the Supabase client throughout the click
  handler, making sign-out throw `Cannot read properties of undefined (reading
  'auth')`. Renaming it fixes the real runtime bug. The existing notification
  browser review confirms state clears on sign-out and late responses cannot
  reopen the session.
- All five mock RPCs accepting London local booking times now use the existing
  London converter instead of fixed BST `+01:00`. Return-time checks pass, with
  additional converter assertions across March/October clock changes and the
  GMT 17:30/17:31 boundary.
- The removal-reason test opens the current Activity dashboard tab.
- Browser sections still get fresh processes, explicit interrupted/missing-summary
  failures and full coverage. Scenario failures print complete stacks. The 250ms
  benchmark section runs alone after the parallel sections. No performance limit
  was relaxed.
- Aero's 1,001-row fixture allows a bounded 30 seconds for pagination, because its
  local SQL stand-in resolves profile/site embeds per row. Ordinary ranges keep
  five seconds. All display/export/formula-protection assertions remain. No Aero
  application runtime changed.

The earlier #166–#169 fixes remain incorporated. Setup 130/131/132 and rollback
scripts are source only; no SQL was applied to Supabase.

| Accepted gate | Result |
| --- | --- |
| Full Parking browser command | Exit 0; **2,710 passed, 0 failed**, all 25 sections |
| Exclusive 400-car benchmark | Open 528ms (<3s), tap 49ms (<250ms), search 40ms (<1.5s) |
| All 48 Parking root check scripts | All exit 0, synthetic/local services |
| Aero full Step 5 gate | Exit 0; staff/manager/demo at 360/390/430/1440px, late responses, session/tenant isolation, corrections/audit, overnight/DST, CSV protection and 1,001-row export |
| Four formerly sandbox-blocked scripts | release-readiness, shared-integration, shared-staff and shared-manager pass |
| Synthetic Step 6 readiness | 27 checks passed |
| Mixed synthetic staff journeys | All four widths pass |
| Notification-centre browser review | 126 checks pass, including delayed response after sign-out |
| Call-queue browser review | Eight responsive widths pass |
| Phone-bridge, voice-menu, import reviews | Synthetic/local reviews pass; no physical phones/messages/calls |
| Generated bundles, syntax and whitespace | Pass |

Full browser command: `CHROMIUM=/usr/bin/chromium node checks/e2e/run.mjs`.
The previous 580-second browser-closure cascade did not recur in the completed
final run. Earlier fixture failures, cancelled overlapping runs and a 267ms tap
under contention are diagnostic evidence only. The accepted full run has no
hidden retries: `parking-browser-acceptance.log`.

Durable logs/screenshots and their README are in
`/workspace/attendance-verification/2026-10-28/`. Temporary detailed logs were
also under `/tmp/attendance-release/` before the workspace restart.

## Exact older Preview — read-only inspection passed

Vercel project `takeoff-ops`, ID `prj_Ll3pMLhK1tF1ur4CcpV8H1vSQQ7m`, account
`team_zsuQ086XKtFoVsAjg76W946Y`; READY deployment
`dpl_8D4KniLsHA3Yejcgg5rBtM3e2WAc`, exact source
`569b604862c52d70134c8b733fe3c529189ee0b1`:

https://takeoff-qwmbgx4fo-rakeshbrahmandlapalli-pngs-projects.vercel.app/

Page, app/reader/vendor scripts, manifest and service worker returned HTTP 200
and matched that source, excluding only Vercel's exact appended feedback script
from the HTML comparison. CSP, framing, referrer and content-type headers were
present. Signed-out layouts passed at 360/390/430/1440px without overflow or page
errors. Assets were fetched through the session proxy with TLS verification
retained and supplied to the browser. External/Supabase/write requests were
blocked before transmission. No authenticated production/API journey occurred.

**This Preview predates the new sign-out fix and references production.** No
additional Preview was deployed in this round. Do not enter a production personal
link, clock a shift or test live push there. Functional acceptance needs a
reviewed current-head HTTPS staging configuration, an isolated shared backend,
synthetic identities in two fictional tenants and separate test push credentials.

## Remaining gates and restrictions

The owner confirmed both Android and iPhone are available. Physical install,
reopening, session separation, foreground/background push, GPS permissions and
accuracy, offline/timeout/retry/recovery and revocation checks remain unperformed.
Use `aero-attendance/checks/RELEASE-READINESS.md` for the physical procedure.
Neither TAKEOFF identity was activated.

Real Auth/PostgREST staging acceptance, durable notification recovery after retry
exhaustion, production physical-backup restore/PITR/Storage evidence, security
advisor triage, additive migration/rollback rehearsal, zero-downtime existing
client preservation, deployment/monitoring/kill-switch planning and explicit
release/pilot UUID approval remain gates. Synthetic restore checks do not prove
production physical-backup recoverability.

No production/Supabase changes, migrations, environment edits, main merge,
production deployment, promotion, production domain assignment or Attendance/
pilot activation were performed. Automatic branch builds remain disabled in
both repositories. Wider rollout remains prohibited.
