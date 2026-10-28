# Step 5 — manager workflow acceptance

Scope: manager workflow acceptance against the isolated shared test backend.
Stop before Step 6. Notifications, phones, GPS, live Supabase, applying migrations,
deployment, merging and pilot activation are excluded.

The existing five-file working change set was preserved, reviewed and completed;
the work continued on the same remote `attendance-integration` PR branches.

## Verified starting point

| Repository / open draft | Starting remote and local head |
| --- | --- |
| Parking-Ops #165 | `ef3a0929ecfad25875cc06cb9e155006622a0d72` |
| aero-attendance #4 | `97af772957bdf21091afec06efd7a2d281f2bbea` |

Both checkouts were clean and matched GitHub before this step. Both branches
retain their existing automatic-deployment suppression in `vercel.json`.

## Manager workflow changes

- Shared manager login skips the legacy password-change dialog. Failed password
  login removes only the manager session; staff, legacy and parking sessions stay
  separate. One-time handoff replay and denied manager entry are checked.
- Logout clears manager datasets, filters and dialogs. Responses from an old
  session cannot restore the previous tenant's data. Newer timesheet, correction
  and audit reads win over late older responses.
- Timesheets fetch all pages with a stable order. CSV exports cannot silently
  label old data with edited date/person filters or export a failed partial load.
- Correction approval/rejection records the actual manager and audit event.
  Response-loss recovery confirms the exact actor, decision and note before
  treating a failed response as successful. Self-review, stale/overlapping
  requests, replay and other-tenant review remain blocked by the real SQL.
- Timesheet and audit CSV cells share formula protection, quoting and multiline
  escaping. Actual downloaded files are parsed during browser acceptance.
- Existing SQL already supports the accepted manager flows. No SQL, policies,
  generated schema, migrations or notification implementation changed.

## Acceptance coverage

- Manager/owner gates; denial for staff, removed users, non-testers and revoked
  managers; direct tenant boundaries for staff, shifts, corrections and audit.
- Overview search/site filters, staff search/status filters, removed-staff history,
  date/person/completed-shift filters, pending/approved/rejected review filters,
  audit action filters and filtered CSV downloads.
- Approval updates shift times and preserves breaks/notes. Rejection preserves
  the shift. Audits have one decision record with the correct actor; clients
  cannot forge or modify audit entries.
- Overnight shifts show the correct end date and subtract breaks once. The
  Europe/London spring day is 23 hours; the autumn day is 25 hours. Date boundaries
  include their first/last local instants correctly. The repeated 01:30–01:30
  autumn hour is one elapsed hour; spring 00:30–02:30 is also one elapsed hour.
- A 1,001-row timesheet spans three pages and exports all 1,001 rows. Partial-page
  failure, competing queries, delayed success/failure, delayed pre-decision reads
  and responses arriving after logout are checked.
- Manager journeys at 360, 390, 430 and 1440px have no page/control overflow or
  uncaught errors. Staff/shared session preservation is checked throughout.

## Full local verification

Result: **passed**. The complete gate passed all 225 counted checks, the shared
transport/handoff assertions, and the responsive demo/staff/manager journeys.

Install the pinned developer dependencies in both sibling repositories, then run
from either repository root:

```sh
npm --prefix ../Parking-Ops/checks ci --ignore-scripts
npm --prefix ../aero-attendance/checks ci --ignore-scripts
npm --prefix ../aero-attendance/checks run step5
```

The gate includes:

- Existing smoke 15, embeds 6, resilience 16 and pay maths 32 (69 checks).
- Existing shared transport, 44 shared staff SQL checks and backend handoff checks.
- New manager SQL 78 and manager runtime 34 (112 checks).
- Existing demo/navigation and staff browser regression journeys at all four
  widths; manager journeys at those same widths. Staff regression uses a synthetic
  unavailable-location result, never GPS or a device test.
- Staff/manager script parsing, handoff syntax, generated parking/Attendance
  consistency, whitespace, branch ancestry and deployment-suppression checks.

Notification-specific suites and mixed suites with notification assertions are
not invoked. Notification preference reads during page bootstrap receive an
out-of-scope test response; no notification operation is accepted or exercised.
GPS/device APIs are not used by manager acceptance. Step 6 has not started.

## Verification limits

The real pages, vendored Supabase client, shared transport and current namespaced
SQL are exercised. Synthetic Auth/REST adapters consume fake tokens and run
parameterized queries/RPCs under real restricted PostgreSQL roles in PGlite.
The adapter resolves only explicitly supported direct foreign keys. Browser
requests are fulfilled locally or blocked; no live Supabase or production data
is used. Parking rows are hashed before and after the manager journeys and must
remain identical.

This is local acceptance, not real GoTrue/PostgREST or live deployment acceptance.
Those gates and all Step 6–8 release/pilot work remain pending. Both PRs stay draft.
