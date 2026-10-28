# Step 4 — staff workflow acceptance

Scope agreed on 28 October 2026: staff acceptance against the isolated shared
test backend. Stop at Step 4. Manager approval UI, timesheet/export acceptance,
notifications, phone/GPS testing, live Supabase, migrations, deployment and pilot
activation remain for Steps 5–8. The existing shift list is used only as the
entry point for a correction request; its totals and exports are not accepted here.

## Starting point

Both clean repositories were checked out from the remote `attendance-integration`
branch and verified against the open draft PR heads before editing:

| Repository / draft | Verified starting head |
| --- | --- |
| Parking-Ops #165 | `1a64398967e5f8a750381bd6fde3593deab49a6c` |
| aero-attendance #4 | `ba9b93165428f0c07af943994f8c17a676f9f3cc` |

## Acceptance and changes

- Single-use handoff: consume and remove the fragment; reject replay, empty and
  failed exchanges; erase any previous staff session even if logout is offline.
- Staff sessions: separate from shared manager, legacy Attendance and Parking Ops.
  Shared sign-out uses `scope: local`; failed password login also clears the old
  staff session. Shared login skips the legacy password-change dialog, preserving
  parking credentials. Other apps' storage is checked throughout browser journeys.
- Staff lifecycle: clock in, display and reload the current shift, start/reload/end
  a break, clock out with a note, and submit a correction which remains pending.
- Revocation: ordinary data becomes unavailable. Clear the regular staff state,
  timers and dialogs before presenting a single finish-only screen. It can end
  an existing break or clock out, including when a committed response is lost.
  It cannot start a new shift/break or request a correction. A colleague's shift
  stays untouched. Clocking out during an open break finishes it once.
- Verification reads the actual sibling `Parking-Ops` checkout, not `takeoff-ops`.
  It requires both `attendance-integration` branches to include their fetched PR
  refs and prints their current heads. The tests run working files so fixes can
  be verified before committing.
- `build-attendance.mjs --check` compares generated schema, name manifest and
  sender with their sources without writing or applying anything.
- Both `vercel.json` files disable automatic Git deployment of only
  `attendance-integration`, allowing draft updates without a preview deployment.

## Full local verification

With these two repositories checked out side by side:

```sh
npm --prefix ../Parking-Ops/checks ci --ignore-scripts
npm --prefix ../aero-attendance/checks ci --ignore-scripts
npm --prefix ../aero-attendance/checks run step4
```

The gate runs:

- Staff/manager script parsing, shared transport and Edge Function syntax,
  whitespace, deployment suppression and both generated-file consistency checks.
- Existing Attendance baseline: isolation 455, smoke 15, resilience 16, embeds 6,
  pay maths 32 and restore round-trip 53 (577 total).
- Shared transport and shared schema tests, including repeat installation,
  tenant/tester gates and existing backend regressions.
- 44 staff SQL checks under ordinary staff roles in two synthetic companies.
- Parking Ops handoff, 60 client-settings checks, identity/pilot/clocking/isolation
  regressions, top-up 73, call workflow 15 and notification clearing 26.
- Existing staff/manager demo navigation at 360/390/430/1440px.
- Complete staff journeys at all four widths, plus lost-response recovery for
  committed clock-in/out and finish-only operations. These use the actual pages,
  vendored client and namespaced SQL through a local test adapter.

`CHROMIUM_PATH` can select a local Chromium for the staff journey test; the default
is `/usr/bin/chromium`. Playwright and PGlite are pinned in the checks lockfile.

## What this proves

The browser uses the real client and shared transport. Test Auth mints and consumes
fake single-use handoffs; the limited REST adapter executes queries/RPCs under
the authenticated role against PGlite and the current generated shared schema.
All requests are fulfilled from disk/in memory or blocked. Parking rows are
hashed before and after the staff journeys and must stay identical.

Auth, the REST adapter and location are synthetic. This does not prove real
Supabase Auth, PostgREST relationship discovery, physical GPS, phones or delivery.
Existing manager/backend regression tests run unchanged; no manager acceptance
work is included. No production data or credentials are used, no Supabase
migrations are applied, and no pilot account is activated.
