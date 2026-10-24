# Booking import review upgrade

Date: 24 October 2026. Prepared against `31b9a53` (review package, local commit
`f4fb146`), rebased onto `main` after #123–#127 and released at the owner's
request: setup 111, `takeoff-bookings` v20, then the frontend.

## Behaviour

Both import methods keep the existing operations identity and permissions.
Auto import remains an optional connection. The supplier integration is still
read only: changing a yard in this app does not update the supplier website.

### Automatic import

- Today / next three days / next seven days shortcuts, with the existing
  custom date range and 14-day maximum.
- Existing connection health and schedule controls, including the next saved
  slot in London time. Installing this upgrade never enables a schedule.
- Check / review / import steps, date coverage and protected operational data.
- Checkboxes select individual new/updated bookings; unresolved or unreadable
  records cannot be selected. The server validates every selection against the
  freshly collected plan. All changes are returned, including beyond 200 rows.
- Registration and earlier-return alerts, existing board/yard/position context,
  and access to the affected booking through the existing office actions.
- Staff-edited registration or dates and cars with a driver are held back.
- Preview hashes include the existing booking snapshot. A second comparison
  happens inside the write transaction to reject intervening staff changes.
- Scheduled imports keep the existing hold rules and use the checked writer.

### Manual import

- Compact upload rows. Multiple spreadsheets, Joblist PDFs and flight reports
  can be checked together (20 files / 40 MB total; 10 MB per booking file).
- Detects spreadsheet / Joblist / flight-report shape. A known wrong board type
  is rejected. The separate flight report is optional and is not requested
  for a Joblist that already includes flights.
- File names, dates, row/page provenance and an expandable extracted-booking
  table. The checked-file panel starts collapsed on phones to prioritise review.
- Flight report references are checked; available report dates must match.
  Reports with no readable dates explicitly say dates could not be verified.
- Read-only server comparison of all parsed sheet dates, new / updated /
  unchanged / held classifications, before/after values, search and selection.
- All duplicate references across uploaded dates/files are held, including
  formatting overlaps. Invalid registrations/dates, cancellations and unknown
  sheet moves are held for review. Missing-date rows remain visible in file
  issues. Missing-from-file cars are reviewed, never automatically removed;
  carried overstays, early returns and completed cars are excluded from this check.
- Existing typed flight numbers and staff notes are preserved. Supplier fields
  are whitelisted; key/board numbers, lane positions, drivers, payment records,
  photos and operational state cannot be supplied through the reviewed RPC.
- Keep-current leaves a conflict out of the import. Explicit incoming
  registration/return corrections use the existing audited office actions and
  require the preview still to match. Moves and other unsafe conflicts open
  the booking for its normal office workflow.
- Selected rows across the checked dates are imported in one transaction.
  A failure rolls the entire selection back. Retry keeps an idempotency ID;
  a response lost after success cannot create a second import. There is no
  partial-success assumption and no silent fallback to the old unreviewed RPC.
- Completion stays on the import page, links to affected boards and lets the
  office review remaining entries.

### History and undo

Three grouped recent runs appear on the main page. Full history offers method,
date and text filters, filenames, uploader, results and field changes. Reviewed
run metadata is retained for 90 days; its private table is not client-readable.
Recent runs retain the existing 24-hour undo window. Undo is inside run details,
first reads a preview of affected bookings/fields, then uses the existing
field-by-field undo protections. Activity-log access is linked from history.
Preview checks remain read only; successful imports, explicit corrections and
undo use audited writes. Older imports without reliable source metadata are
not assigned an invented filename or method.

Board numbers are labelled as board numbers. This upgrade does not invent a
separate physical key-tag identity where the existing schema has none.

## Database change

`setup/111-reviewed-import.sql` (the package's
`supabase/migrations/20261024013128_reviewed_booking_import.sql`, renumbered:
this database is installed from numbered setup parts, never `supabase db push`).
Prerequisites: setup through 110, lanes from 104. Additive; no schedule or
config changes. Changes made while adapting it to the live data:

- Snapshots compare only supplier fields, sheet, SENT/CLEAR/removed/early/
  overstay and the office's typed marks. The first version hashed whole rows
  and all activity, so a flight check, a yard move or a SENT on any car of the
  sheet between Check and Import refused it.
- `swift_apply_checked` locks and compares only the bookings it writes;
  manual apply/resolve lock the uploaded refs and the uploaded sheets' cars,
  not every booking of the company.
- A booking with no registration (blank or ".", as the booking site and
  Airport Parking Bay's files send) is imported and flagged "No registration
  yet" instead of being invalid; the auto planner no longer counts it invalid
  (which would have held every scheduled import). Misread registrations
  (dates, descriptions) are still invalid.
- The 90-day trim of `private.import_review_runs` is `setup/111b-reviewed-import-trim.sql`,
  run in the SQL editor (the Supabase MCP refuses SQL containing DELETE). Optional.

There are no new browser runtime dependencies. `public/app.js` is generated
from the 21 source parts with `node src/build.mjs`.

## Verification

All data in these tests is synthetic. Browser routes intercept Supabase and
supplier requests; Postgres checks use throwaway PGlite. No real booking file
or supplier login was used.

- `node checks/reviewed-import.mjs`: 38 database/planner checks passed.
- `node --experimental-strip-types --no-warnings checks/import-edge.mjs`:
  9 checks passed, including actual interactive/scheduled edge orchestration.
- Import browser regression section 05: 166 checks passed.
- Office/key-check browser section 07: 144 checks passed.
- `node checks/e2e/import-review-run.mjs`: the final focused result is recorded
  in the delivery test results. Covers 360, 390, 1024 and 1440 px, other looks,
  selection, no-write preview, conflicts, retries, missing setup and history.
- Existing `checks/swift-sync.mjs`, `checks/import-reader.mjs`,
  `checks/stress-joblist.cjs` and `checks/dates.cjs` passed.
- Build consistency, JavaScript/TypeScript syntax and diff whitespace checked.

The broad browser run was executed during implementation. Its stale import
expectations were updated and the affected suites were rerun as above. Five
non-import assertions also fail against the untouched base: narrow Operations
board/header and Settings overflow, a desktop Picks fixture/format assertion,
Operations Refined staff-row height, and Operations tile overflow. These were
not changed as part of the import work. The full application suite is therefore
not represented as completely green.

## Rollback

1. Revert the frontend merge commit on `main` (Vercel redeploys).
2. Redeploy `takeoff-bookings` v19 (`git show <merge>^:supabase/functions/takeoff-bookings/*`),
   verify_jwt off as before.
3. Only then, if the new RPCs must be disabled, run
   `setup/rollback/111-reviewed-import-rollback.sql` (revokes them, restores
   the 110 `recent_imports`). It keeps `private.import_review_runs` and every
   booking/import row; don't drop run history as a routine rollback.
