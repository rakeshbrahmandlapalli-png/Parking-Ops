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
- Supplier Name values seen: HES (Booking Type PR), APL (MG), L4P (MG). Which of these is TakeOff is **not known**.
- Booking Status values seen: Booked, Collected.
`
## Still not verified
- the report page addresses behind the Booking Manager search and its export, and the export's real file format
- whether the export is paginated, and the sign-in success response
- which Supplier Name / Booking Type means TakeOff (`scope` may be a list, e.g. `[{"column":"Supplier Name","values":["…"]},{"column":"Booking Type","values":["MG"]}]`)
Run **Check bookings** once and read the answer before anything else; an unreadable or
unexpected report stops with a plain message and nothing is imported.

## Setup (in this order, each after the user's approval)
1. Review and merge the PR. Do not deploy before step 2.
2. Apply `setup/86-swift-readonly-sync.sql` (SQL editor; safe to run twice).
3. Supabase → Edge Functions → Secrets: add `TAKEOFF_BOOKING_LOGIN` and
   `TAKEOFF_BOOKING_PASSWORD` yourself (never in chat or in the repo). `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function by Supabase.
4. Deploy `takeoff-bookings` with **Verify JWT off** (the function checks the caller itself).
5. Save TakeOff's settings (SQL editor, once the report addresses and supplier column are known):
```sql
insert into private.auto_import(company_id, provider, config)
select id, 'swift', '{
  "base": "https://www.luton.swiftairportparking.co.uk/admin/",
  "manual_enabled": true,
  "login_path": "index.php?req=login",
  "login_fields": {"login": "login", "password": "password", "extra": {"action": "Sign In", "url": "%3F"}},
  "export_path": "export_to_excel.php",
  "drops_search": "<Booking List address with {FROM} and {TO}>",
  "picks_search": "<Booking List / Meet Report address with {FROM} and {TO}>",
  "flights_search": "<Return Report address with {FROM} and {TO}>",
  "scope": {"column": "Supplier Name", "values": ["<TakeOff's supplier name>"]},
  "drops_days": 2, "picks_days": 3
}'::jsonb
from companies where slug = 'takeoff'
on conflict (company_id) do update set config = excluded.config;
```
   (the login form fields above are from the public sign-in page; the rest are placeholders)
6. Import → Check bookings. Read the list. Only then Get bookings now, and use Undo if needed.
Leave the schedule off until the first import has been reviewed.

Tests: `cd checks && npm install @electric-sql/pglite && node swift-sync.mjs`.
