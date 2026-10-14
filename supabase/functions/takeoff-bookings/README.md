# takeoff-bookings — read-only Swift booking sync (TakeOff only)

Manual only. The phone's Import screen has **Check bookings** (a dry run: it signs in
to the booking site, reads the approved reports and shows new / changed / unchanged /
for review / unreadable; it writes nothing to bookings) and **Get bookings now**
(imports exactly the plan that was checked; if the site's answer has changed since, it
refuses). The timer action is refused. Airport Parking Bay is refused in the code.

On the booking site it does only: sign in (one POST, never retried), then GET the
approved report pages and the export. Every address is checked: https, the approved host,
inside `/admin/`, one of the listed report scripts, no edit/cancel/status/password pages,
redirects followed by hand (max 3) and re-checked, at most 8 requests a run, cookies only
for that host. A failed sign-in pauses the sync for an hour.

## Seen in the user's photos of Booking Manager (14 Oct), not from a login here
- Columns: Ref#, Supplier Name, Booking Type, Payment Status, Full Name, Booked, Meet, Return, Vehicle, Total Days, V/Code, V/Value, Booking Status. Dates read as `14-10-2026 21:00`.
- Filters: a "Meet" / "Return" choice with from/to dates (Meet for PICKS, Return for DROPS), Excel and PDF export icons.
- Vehicle holds make, model and plate together (the reader splits the plate off the end). No phone or flight column; flights come from the Return Report.
- Supplier Name values seen: HES (Booking Type PR), APL (MG), L4P (MG). The owner confirmed on 14 Oct that **every booking on this site is TakeOff's**, so the scope is `{"all": true}` (still required in the config, so it is a deliberate choice).
- Pages: Booking Manager `/admin/bookinglist-parkandride.php?req=news` (Meet for PICKS, Return for DROPS; Excel (`export_to_excel.php`) and PDF (`bookinglist_report.php`) icons; search = GET form `action_Search, search, productype, filter_status (1 Completed, 2 Cancelled), supplier, filter_field (bookings.booking_from = Meet, bookings.booking_to = Return), filter_from, filter_to`, dates like `14-October-2026`); the page also has Edit/Cancel links and a status dropdown, none of which are ever called. Return Report `/admin/arrival_report_parkandride.php?req=news` (columns Time, Agent, Ref#, Client, Airport, Telephone, Day, Car Make, Car Reg, Flight No., Flight Time, Booking Status, Return Type, Drivers; only a PDF icon, so flights are read from the page's table with `flights_format: "html"`; its Flight No. boxes are editable on the site, the sync only reads them).
- Booking Status values seen: Booked, Collected.
`
## Still not verified
- the report page addresses behind the Booking Manager search and its export, and the export's real file format
- whether the export is paginated, and the sign-in success response
- the Return Report's search form field names; whether `export_to_excel.php` follows the last search (the check refuses it if not)
Run **Check bookings** once and read the answer before anything else; an unreadable or
unexpected report stops with a plain message and nothing is imported.

## Setup (in this order, each after the user's approval)
1. Review and merge the PR. Do not deploy before step 2.
2. Apply `setup/86-swift-readonly-sync.sql` (SQL editor; safe to run twice).
3. Supabase → Edge Functions → Secrets: add `TAKEOFF_BOOKING_LOGIN` and
   `TAKEOFF_BOOKING_PASSWORD` yourself (never in chat or in the repo). `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function by Supabase.
4. Deploy `takeoff-bookings` with **Verify JWT off** (the function checks the caller itself).
5. Save TakeOff's settings (SQL editor). The Booking Manager search is a GET form (seen in the page source on 14 Oct), so the addresses below are exact; only `flights_search` still needs the Return Report form's field names:
```sql
insert into private.auto_import(company_id, provider, config)
select id, 'swift', '{
  "base": "https://www.luton.swiftairportparking.co.uk/admin/",
  "manual_enabled": true,
  "login_path": "index.php?req=login",
  "login_fields": {"login": "login", "password": "password", "extra": {"action": "Sign In", "url": "%3F"}},
  "export_path": "export_to_excel.php",
  "drops_search": "bookinglist-parkandride.php?action_Search=action_Search&search=&productype=all&filter_status=1&supplier=all&filter_field=bookings.booking_to&filter_from={FROM}&filter_to={TO}&submit=Search",
  "picks_search": "bookinglist-parkandride.php?action_Search=action_Search&search=&productype=all&filter_status=1&supplier=all&filter_field=bookings.booking_from&filter_from={FROM}&filter_to={TO}&submit=Search",
  "cancelled_search": "bookinglist-parkandride.php?action_Search=action_Search&search=&productype=all&filter_status=2&supplier=all&filter_field=bookings.booking_to&filter_from={FROM}&filter_to={TO}&submit=Search",
  "flights_format": "html",
  "scope": {"all": true},
  "drops_days": 2, "picks_days": 3, "cancelled_days": 14
}'::jsonb
from companies where slug = 'takeoff'
on conflict (company_id) do update set config = excluded.config;
```
   Add `"flights_search": "arrival_report_parkandride.php?<its filters>"` once its form is known. Completed bookings only are imported; cancelled ones come from the status-2 search and go to the review list. The check also refuses an export whose dates don't match the search (in case the site ignores the filter).
6. Import → Check bookings. Read the list. Only then Get bookings now, and use Undo if needed.
Leave the schedule off until the first import has been reviewed.

Tests: `cd checks && npm install @electric-sql/pglite && node swift-sync.mjs`.
