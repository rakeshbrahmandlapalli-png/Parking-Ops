# Parking Ops (takeoff-ops) — notes for the next session

Multi-tenant parking-operations PWA (airport meet & greet). One codebase, several
client companies, each with its own brand and look. Owner: Rakesh (signs in as
owner; also the platform admin, "Parking Ops").

## Where things are
- `src/app/NN-*.js` — **edit the app here**, not in `public/app.js`: 21 parts cut by
  area (00-start opens the one IIFE, 18-swipe-update closes it). After editing run
  `node src/build.mjs` to write `public/app.js` (the parts joined, committed so
  Vercel needs no build); `node src/build.mjs --check` and the first e2e test fail
  when they differ.
- `public/` — the whole app as served: `index.html`, `app.js` (~6.3k lines, built
  from `src/app`), `app.css` (Standard), look stylesheets (below), `reader.js` (booking
  PDF/Excel reader), `pt.html/pt.js` (PT photo link page), `sw.js` (offline cache;
  **bump `CACHE` when adding a file to `FILES`**).
- `setup/NN-*.sql` — database parts, applied in order to the live DB. **99** (Online / Offline on Staff & access: the app calls `i_am_here()` every minute while on screen into `staff_seen`; `staff_seen()` for `can("staff")` returns each person's last check-in and last activity; Online = within 5 min, Operations look only; applied by Claude on 20 Oct at the user's request). **98** (button stamps carry the picked name: `bookings.by_name`; applied by Claude on 20 Oct at the user's request). Latest applied: **110** (Remove a car: RTC and Early return reasons beside No show / Cancelled / Duplicate, `remove_booking`; applied by Claude on 24 Oct at the user's request; app `REMOVE_WHY` in src/app/07, two rows of buttons; dashboard counts them from the list, owner_dashboard totals have no keys for them; test `REMOVE_ONLY=1 node run.mjs`); before: **109** (Collections add-on); before: **108** (activity log for every action); before: **107** (Yard planner add-on switch, see below; 106 is reserved by another branch); **104** (lane planner); before: **99**;. **97** (names on a shared login: `staff.desk_names`/`acting`, `set_desk_names`, `set_acting`, activity trigger; applied by Claude on 20 Oct at the user's request). **96** (a return moved to a later day whose DROPS sheet is not in yet puts the car in OVERSTAYS; applied by Claude on 16 Oct at the user's request; check checks/later-return.mjs). before it **97**, **96**; **95** (OVERSTAY taken off a car due back on its sheet clears `overstay`; carried cars stay overstays; applied by Claude on 15 Oct at the user's request; check checks/overstay-undo.mjs); **94** (more clients, applied by Claude on 15 Oct at the user's request with `flights` v28 and `send-alerts` v20: read rules check the company once per query, flights timer every minute with `slot:true` so each client gets one minute in ten by `created_at` order; push/Discord texts use the client's name). Before: **93** (shared key check, 15 Oct, at the user's request); **91** (92 applied by Claude on 15 Oct at the user's request: a changed reg reaches the booking's other row, imports keep it; check checks/reg-change.mjs) (the 10-minute clock `takeoff-bookings-schedule` for scheduled booking import) and 90 (scheduled import: `swift_schedule_set` owners/managers, `swift_schedule_mark`, `swift_reviews_known`, `auto_import_status` returns `schedule`) applied by Claude on 14 Oct at the user's request; 89 (recent_imports returns the import source, applied by Claude on 14 Oct at the user's request) and 88 (long-wait alert) and 87 (Swift sync imports as the person pressing the button, because the old "Auto import" user broke staff_user_id_fkey) and 86 (read-only Swift sync: lock, review list, preview helpers, atomic apply) applied by Claude on 14 Oct at the user's request; (85 (dashboard totals not capped at 300 rows, `exit.paid_cars`, early returns counted per car, handover note `set_handover_note` for owners/managers) applied by Claude on 14 Oct at the user's request; 84 (dashboard exit fees: `owner_dashboard` returns `exit` — paid, cash/card, no photo, exempt, cars handed back with none recorded since the first exit fee) applied by Claude on 13 Oct at the user's request; 83 (a typed scheduled/collection time more than 6 h from the booking lands inside the DROPS sheet's night, so 00:22 on a 12:00 booking is tonight's; `set_sched_time`/`set_collect_time`, same rule in `collectAt`) applied by Claude on 10 Oct at the user's request; 79–82 dashboard parts; 78 (PICKS car: Return flight `set_pick_flight`, carried to its DROPS car when that has none, logged FLIGHT so imports keep it; office changes the return `set_pick_return`, its DROPS car follows via `set_return`) applied (live on the DB, checked 17 Oct); 77 (yard colours, `set_yard_colours` owners only; APB starts MY green, GS orange, T yellow) applied by Claude on 10 Oct at the user's request; 76 (exit fee, `set_exit_fee` owners only, `set_exit_paid` with photo) applied by Claude on 10 Oct at the user's request; 75 (EARLY RETURN on a night picked: `early_return(uuid, date)`, `early_return_from_picks(uuid, date)`; the one-argument versions mean tonight) and 74 (EARLY RETURN from the PICKS car) applied by Claude on 10 Oct at the user's request; all applied; the Supabase MCP's execute_sql hangs on DROP statements (asks for a confirmation), so avoid DROP in tests; 73 (dashboard counts DROPS yards, DROPS yard fills empty PICKS location) by Claude on 8 Oct at the user's request; 72 (Operations look) by Claude on 7 Oct at the user's request; 70 and 71 (capacity) by Claude on 7 Oct at the user's request; 68 and 69 run by the user in the SQL editor on 7 Oct — they prefer running SQL themselves; DB checks: checks/carry-from-picks.mjs, checks/desk-booking.mjs, checks/drops-yard-to-picks.mjs, checks/yard-colours.mjs, checks/picks-return-flight.mjs).
- `supabase/functions/` — edge functions (flights, manage-staff, pt-photos, pt-r2,
  send-alerts, staff-login, takeoff-bookings — Swift read-only sync, see below).
- `checks/` — tests (see `checks/README.md`).
- `public/tutorials/` — the 7 how-to videos (owner, terminal, bongo); played from Menu → Tutorials (not cached by `sw.js`); see its README.
- Hosting: Vercel (`takeoff-ops.vercel.app` TakeOff, `parkingbay-ops.vercel.app`
  Airport Parking Bay), deploys from `main`. Phones fetch the new app network-first.
- Supabase project **`oioqjfrlwrjovnouhusp`** ("Ops", Pro plan).

## Clients (companies.brand)
| Client | Look (`brand.theme`) | Brand colour |
|---|---|---|
| TAKEOFF (`takeoff`) | `stdplus` (Standard with features) | amber `#F9A01B` |
| Airport Parking Bay (`airport-parking-bay`) | `premium` | blue `#1560BD` |
| Parking Ops (platform) | standard | — |
Looks are switched on the platform page: Clients → Edit → LOOK
(`admin_save_client` validates the allowed list — add new themes there via a new
setup part).

## The eight looks — each its own stylesheet, never sharing styles
| Label | theme | html class | CSS |
|---|---|---|---|
| Standard | (none) | — | `app.css` |
| Airport Parking Bay UI | `pro` | `pro` | `pro.css` |
| Cards (light and dark) | `cards` | `cards` | `cards.css` |
| Premium UI | `premium` | `premium` | `premium.css` (big cards) |
| Premium Board | `board` | `premium` + `pboard` | `premium.css` + `board.css` (rows exactly like Standard) |
| Standard with features | `stdplus` | `stdplus` | `app.css` + `stdplus.css` |
| Operations | `ops` | `stdplus` + `ops` | `app.css` + `stdplus.css` + `ops.css` (navy/grey chrome from the 7 Oct TakeOff preview; Drops | Picks in the top bar, the day picker then lists only that kind; job rows stay exactly Standard's and the first row must start no lower than in Standard with features, tests check both; Hourly stats is a page (view `stats`, `renderStats`) and Shift summary uses panels — `opsStrip/opsPanel/opsTable`; Menu and the car panel ("Booking details", `#panel.ops-car`) are full pages between the top and bottom bars; Staff & access (`opsStaff`), Flights (`opsFlights`) and Settings have their own ops layouts; other looks get the exact old HTML via `L()/fld()/opsSec()/boxTitle()`; **900 px and wider** (`opsDesk()`, `body.ops-desk`): the bottom bar moves under the top bar as tabs (+ Dashboard and Settings for `can("settings")`), the DROPS board is a table (`opsDeskRow`, `.drow`, columns Return / Registration · vehicle / Flight / Customer · ref / Yard / Status / Actions; the Flight column is the number alone, a button (`.flno`, opens `openQuickFlight` filled in) for `can("flights")`, and the Sch/Est/Landed times sit in Status (15 Oct); 900–1199 px puts the customer under the car) with `opsHead` (title, sheet, full date, shift hours), K reads "Key check", and Flights is `opsFlightsDesk` (Needs attention + Flight status tables, filters, search `#flQ`); PICKS is a table too (`opsDeskPickRow`: Arrival / Registration · vehicle / Customer · ref / Return / Return flight / Status / Actions, the same `pickActs` buttons as the phone); the other pages on desk too: Dashboard a 12-column grid (`.od-row` display:contents), Settings grouped (`.set-desk`, `.set-nav [data-setgo]`, `#set-parking|flights|charges|alerts|data`), Booking details two columns (`.ops-2col`, Status/payments/documents in `.ops-carside`), Summary (`.sum-desk`), Stats with bars (`.st-desk`, `statBars`), Archive results table (`.arch-tbl`), Staff header row (`.ops-th`), Me in three columns (`.me-desk`, tutorials), Menu sections in 3 columns (`.mgrp`); audit shots `AUDIT_W=1440,1024,390 AUDIT_P=<pages> SHOTS=<dir> SHOTS_ONLY=audit node run.mjs`; under 900 px nothing changes (phone shots pixel-identical to main); preview `SHOTS=<dir> SHOTS_ONLY=desk node run.mjs`, fixture `deskDb()`) |
| Operations Refined | `ops-refined` | `stdplus` + `ops-refined` (never `ops`) | `app.css` + `stdplus.css` + `ops-refined.css` (22 Oct, from the user's four-screen picture; merged 22 Oct, nobody switched to it yet). `ops-refined.css` starts with Operations' rules re-scoped to `html.ops-refined` (so a change to `ops.css` doesn't reach it), then its own "Refined" part. `isOps()` is true for both Operations looks (every Operations page/feature), `isRefined()` only for this one; brand colour from the client only. Its own: day picker "Today 22 Oct" (`refinedDay`), sync trouble on its own line under the bar on phones, Booking details as section panels (`refinedCar`: Customer & vehicle, Return & parking / Drop-off & parking, Notes & status, Payments, Documents & photos; a detail with its own box shows once; "Saves when tapped" on yard/mark/payments; footer `#carState` No unsaved / Unsaved changes / the error in red; a tap that saves at once keeps what was typed), Settings as tabs below 900 px (`.set-tabs`, `S.setTab`, the Flight checks box says its own unsaved state), Summary names the shift hours and "N to go", Flights a line per flight (Sch / Est). Revised 22 Oct (user: "too similar to Operations"): its own phone rows (`refinedDropRow`/`refinedPickRow`, `.rfr`: reg 17px with yard and #, then car · customer, then flight · times; buttons in words via `RF_WORDS`, state edges), To do / All with count pills, "Keys" for K (`renderKeyBtn`), names and makes title-cased (`nice`, `niceMake`, `RF_CAPS`); Booking details Customer | Vehicle (`.rf-cv`), return date and time side by side, Sent/Called/Clear stamps (`.rf-stamps`), read-only lines (`.rf-kv`); Summary shift rows with bars (`rfPart`) and an Activity panel (`.rf-act`); Settings a line per setting and the other sections listed under the open one (`.set-more`); Staff a person in three short lines, Booking import one panel, Dashboard payments as label/amount lines (CSS only). A set yard keeps its yard colour on the PICKS button (`.pyard:not(.on)` only gets the white style). Setup **103** (`admin_save_client` allows `ops-refined`) applied by Claude on 22 Oct at the user's request; no client switched to it. Tests `sections/10-ops-refined.mjs`; previews `SHOTS=<dir> SHOTS_ONLY=refined node run.mjs` (REFINED_W=360,390,768,1024,1440) and `SHOTS_THEME=ops-refined SHOTS_ONLY=audit`. |
JS helpers: `isCards()` (cards or premium = card layout), `isPremium()`,
`isBoard()`, `isStdPlus()` (stdplus, ops or ops-refined), `hasFeatures()` (= Premium looks or stdplus/ops/ops-refined), `isOps()` (ops or ops-refined), `isRefined()` (ops-refined).
The user wants looks kept **separate** (a change to one must not change another).

## Features (gated by `hasFeatures()`: Premium, Premium Board, Standard with features, Operations)
- Bottom nav bar (Board, Flights/Returns, Stats, Summary, Menu).
- Swipe on **drops** only: right and left, each person's own choice on their phone
  (Menu → "Swipe right/left on drops": Off/Sent/Called/Clear). localStorage keys
  `takeoff_swipe` (default from role: bongo→sent, office→called, terminal→clear,
  others off), `takeoff_swipe_left` (default off), `takeoff_swipe_only`
  ("Show buttons on drops" switch off = hide drop buttons; rows show what's done,
  tapping the reg opens the car with STEPS buttons to undo). Swipe only marks,
  never unmarks.
- Pull down to refresh; "Hide numbers" fold (`takeoff_tally_folded`).
- Menu in sections with icons; Delete this sheet alone at the bottom (it confirms).
- Summary: progress bar, activity by day with chips/search/coloured dots, picks
  "Cars in by hour" bars.
- Location on PICKS (per client, Clients → Edit, `brand.picks_yard`): picks rows get a YARD button instead of NO SHOW (NO SHOW in the car panel), yard counts under the numbers. Anyone who takes cars in can set it (setup 67).
- Exit fee (Settings → Exit fee, **owners only**, `companies.exit_fee` / `exit_free`, setup 76): references starting with a listed code (letters and numbers only, any case) get a green NO EXIT FEE tag on DROPS rows. Other DROPS cars get an EXIT FEE box in the car panel: 📷 CASH / 📷 CARD take a photo of the payment (pt-photos <company>/docs/<booking>/x<time>.jpg, 90 days) and mark it paid (`set_exit_paid`, anyone who can CLEAR); "Cash/Card, no photo" links; the row then shows EXIT £10 CASH. Nothing shows while no fee is set.
- Flight APIs: FlightRadar24 (`FR24_TOKEN`) for the live timer and Check flights (FR24 only). AeroDataBox (`AERODATABOX_KEY`, AeroDataBox's own Starter plan since 12 Oct: `api.aerodatabox.com`, `X-Api-Key` header, 40,000 units/month, 5 calls/s; it was RapidAPI PRO until its quota ran out 10 Oct) from the timer **every 90 min in working hours, tonight's sheet only, only the 12-hour chunks with a car FR24 can't update (not landed, cancelled, handed back or airborne on FR24)** (the user chose 90 min on 10 Oct), and from Flights → "Fill times · AeroData". Fill times and Check flights: owners, managers and the office any time (no gap); drivers and terminal 2 presses an hour between both, counted per person in `flight_runs.result.by`, shown as "n of 2 checks left this hour" (12 Oct). Settings shows no FR24 credits warning. Settings' timetable interval is gone (`schedule_every_hours` saved but unused). Test: `node checks/flight-sources.mjs`.
- PICKS drop-off moved (setup **102**, applied by Claude on 22 Oct at the user's request, `move_pick(booking, local)`, office `can("import")`): the PICKS car panel has DROP-OFF DATE AND TIME; a new day moves the car to that day's PICKS sheet (refused while that sheet isn't imported yet), everything on the car stays. A PICKS "moved from sheet" review gets Move (to the change's new drop-off). The import itself still never moves PICKS cars. Tests `checks/e2e/sections/09-pick-move.mjs` (`HELD_ONLY=1`).
- PICKS car (every look): RETURN FLIGHT box (anyone who takes cars in or does flights), shown on the row after the drop time; the office also gets BACK DATE AND TIME there (setup 78).
- Yard colours (Settings → Yard colours, **owners only**, `companies.yard_colours`, setup 77): each yard's tag on DROPS rows, the PICKS location button and the car's yard buttons filled with the colour (`applyYardColours` writes `<style id=yardColours>`); a yard with no colour keeps the look's own. Every look.
- Key check (every existing key-check look, DROPS boards, everyone but view-only): **K** beside TO DO / ALL ("Key check" on the Operations desktop). The approved compact check mode stays within the board, with Expected / Found / Unchecked / Missing filters, yards, checker/time and a separate With driver count. Shared state lives in `key_check_sessions` and `key_check_entries` (part **93, applied to the live Ops DB by Claude on 15 Oct at the user's request**); only the display switch remains in localStorage. Old `takeoff_keys` ticks are never imported as shared confirmations. Start joins one shift-specific session, Finish requires all available cabinet keys found, and New check confirms before preserving the previous session and starting unchecked. SENT, CLEAR, returned-to-yard keys and sheet/registration changes invalidate active confirmations. RPCs enforce company/role, active session and per-entry revision; no offline key-write queue. Part 93 must be live before this frontend (it is). Tests: `node checks/key-check.mjs`, `KEYS_ONLY=1 node checks/e2e/run.mjs`; screenshots: `SHOTS=<dir> SHOTS_ONLY=keys node checks/e2e/run.mjs`.
- Dashboard (owner/manager, Menu → OFFICE): parked now by return day, desk adds, money taken/owed/left unpaid, removed, complaints (`owner_dashboard`, setup 66). Standard with features and Operations use `renderOpsDashboard` (classes `od-*`, CSS in stdplus.css), laid out from the user's 13 Oct mockup: Needs attention, Parked now (navy), Upcoming workload (onsite in+out per day), Payments table (exit fees row from setup 84, overstay and charges), Live queues (tonight's DROPS read fresh, `loadDashLive`), Checks and handover, then Desk activity, Cars on site, by yard, Records. The user asked that it not look AI-made: no emoji, icons, gradients or stat-card grids; real figures only. While it loads, Standard with features and Operations draw the loaded head (`odHead`: Loading… in place of Updated, Refresh greyed, the same period bar); test `DASHLOAD_ONLY=1 node run.mjs` (every look). Setup **106** (written 23 Oct, NOT applied until the user says "merge it"): a PICKS car counts as handed back when a CLEAR DROPS car has the same ref in letters and numbers only, or the same reg cleared at or after it came in (Airport Parking Bay types PICKS refs by hand: 33 "past their return" were 5); Upcoming workload matches the same way; rollback in `setup/rollback/`; check `node checks/dashboard-handed-back.mjs`.
- PICKS "+ New booking at the desk" (everyone but view-only): quick form with a docket photo (camera), NEW BOOKING, taken in, location; photo in pt-photos at <company>/docs/<booking>/, kept 90 days, shown in the car panel (also on its DROPS car by ref). Setup 69.
- Push notifications (`send-alerts`, `public/sw.js`): OVERSTAY pushes once per car (alert_log `overstay:<id>`) and never gets the 20-min WAITING push (user, 14 Oct). The TakeOff plane icon/badge shows only on `takeoff-ops.vercel.app`; other hosts get no large icon and the `badge-p.png` P.
- Names on a shared login (office PC, 20 Oct, setup **97**): one link and PIN (e.g. OFFICE); an owner/manager sets the names in Staff → PIN and access → NAMES ON THIS LOGIN (`set_desk_names`); whoever is working taps the name in the top bar or Menu → Switch name (`set_acting`), the bar shows e.g. RAKESH.O, and a trigger writes that name on every activity line. Button stamps (SENT, CALLED, CLEAR, PICKS, PT, exit fee, charges, removed) show the picked name from `bookings.by_name` (setup **98**, trigger `bookings_by_name`; app `byName(r, col)`, `markBy`), else the login's name. Test `HELD_ONLY=1 node run.mjs` (names: checks).
- System health and phone errors (setup **100**, applied by Claude on 21 Oct at the user's request with `flights` v29 and `send-alerts` v21, `note_push_failure`, `private.trim_health` and the `health-trim` timer run by the user in the SQL editor the same night (the Supabase MCP cancels any SQL with DELETE or DROP, even inside a function body: put those in a separate file for the user); `health_alert_staff` = TakeOff RAKESH): the app sends its errors (`oopsLog` → `queueError`/`sendErrors`, 5 s batches, no signal errors) to `report_errors` (private.client_errors, same message within an hour counts up, 60 new lines a day per person, kept 30 days). Platform page: Clients → **Health** (`openHealth`, `admin_health`, product owner only) shows warnings, backups, server calls, AeroDataBox units (calls × `aerodata_units_per_call` 2 of `aerodata_units_month` 40000, an estimate), failed pushes, timers, and per client flights/import/phones/app errors; Clients shows "N things need a look". Timer `health-warning` (15 min) → send-alerts `health`: each warning once a day to platform owners and the staff ids in private.settings `health_alert_staff` (never client owners), plus `health_discord_url` if set. Tests `node checks/health-errors.mjs`, `node checks/health-alerts.mjs`; preview `SHOTS=<dir> SHOTS_ONLY=health node run.mjs`.
- Booking website (Settings, **owners only**, setup **101**, applied by Claude on 21 Oct at the user's request): website address, login name and password for the client's automatic import. The password goes in Supabase Vault (`booking_site:<company>`), never back to the app (`booking_site_status` says only whether one is saved); `booking_site_set` (null password keeps it, all empty removes), `booking_site_login(company)` service role only. `takeoff-bookings` uses the saved login before the TAKEOFF_BOOKING_* secrets. Airport Parking Bay's reader isn't built yet (21 Oct: waiting on which booking system it is). Preview `SHOTS=<dir> SHOTS_ONLY=bsite node run.mjs`.
- Settings sections (`setBox`, src/app/15): on a phone in Premium, Premium Board, Standard with features and Operations, a header per section (title, what it's set to) that opens it, one at a time (`S.setOpen`). The Operations desktop (groups) and Operations Refined (tabs) keep their layouts, with each box marked `data-sec`. Every look with features: an unsaved-changes bar `#setUnsaved` with Save changes (saves every section with changes; not in Refined, which says it in the box); leaving Settings, switching day/kind, or opening/closing a section with unsaved edits asks first (`leaveOk`), closing the app too (beforeunload); a redraw keeps what was typed (`setEdits`/`settingsDrawn`). Standard, Cards and APB UI unchanged. Tests `sections/12-settings-sections.mjs`.
- Every look: menu bottom shows "App version <etag> · up to date" or
  "New version ready · Update now".

- Collections on DROPS (the strip under the board: totals, All / Outstanding / Collected / Needs checking, the Exit / Overstay line under each car, Collection details) is **an add-on** (user, 24 Oct: only some clients take an exit fee): Parking Ops → Clients → Edit → "Collections on DROPS (add-on)" (`brand.collections`, saved as true/false by `admin_save_client`). Setup **109** (applied by Claude on 24 Oct at the user's request): `can('collections')` is false without it (`private.collections_on`), whatever the person's grant; TakeOff and Airport Parking Bay switched on once (a client already switched is left alone). App: `collectionsOn()`; without it rows show the old EXIT/charge tags and Staff access hides "View board collections" (a saved choice is kept). Exit fees, charges and the dashboard are unchanged. The strip folds by tapping its header in every look (`takeoff_collections_folded`, folded line says "£N outstanding" and the filter still on). Tests `node checks/collections-addon.mjs`, `PAYMENTS_ONLY=1 node run.mjs`; previews `PAYMENT_SHOTS=<dir> PAYMENTS_ONLY=1 node run.mjs`; rollback `setup/rollback/109-*`.
- Activity log for every action (setup **108** and `manage-staff` v30, applied by Claude on 24 Oct at the user's request; the user: "Every activity need to be shown on the activity/ app logs" after nobody could see who switched SARFARAZ off): `manage-staff` writes STAFF lines for add, new link and PIN, switch on/off (and the platform's client_owner/client_open); part 108 adds SIGN IN lines (signed in, wrong PIN, locked, tried while switched off), own PIN change, name switch on a shared login, own alerts, access changes say "was … now …", Yard planner area added, booking review Done, Parking Ops client save/pause (staff_name "<name> (Parking Ops)", no staff_id). Summary's Staff chip includes SIGN IN. Test `node checks/activity-log.mjs`.

## Rules the app keeps
- Roles: owner, manager, office, bongo (driver), terminal, view. Permissions via `can()`.
- A drop is done when SENT and CLEAR. **"TO DO (N)" counts cars not yet SENT**
  (`waiting()`), not the list length — the user asked to keep it that way.
- DROPS day ends at `drops_day_end` (06:00); PICKS by meet day.

## How we work (user's preferences)
- Build on branch `claude/happy-einstein-ih46nt`. Show **previews** (Playwright
  screenshots via SendUserFile) before merging; merge only when the user says
  "merge it". Squash-merge the PR, then reset the branch to `origin/main` and
  force-push it (it only carries merged history).
- Keep UI text short; the user removed explanatory notes in the menu (keep only
  the Display note).
- Tests: `cd checks/e2e && timeout 580 node run.mjs` — **1040 passing, 0 failing** on 20 Oct (each section closes its pages after it runs)
  2026. Add tests for every change. Write output to a file and grep `FAIL|passed`.
  The mock Supabase lives in `harness.mjs` (`rpc()` cases, REST routes); the tests are in
  `checks/e2e/sections/NN-*.mjs` (run in name order; add a new area as a new file), stress in
  `stress.mjs`, previews in `previews.mjs`; `run.mjs` only runs them.
  Previews: `SHOTS=<dir> node run.mjs` screenshots TakeOff's look (phone and desktop).
  Stress: `STRESS=1 node run.mjs` (37 checks) and `node checks/stress-joblist.cjs`. The board
  re-renders only changed rows (`setMain` + `boardChunks`); keep row HTML one element per row.
- New DB part: copy the previous `admin_save_client` part, change only what's
  needed, check the live definition matches the previous part first, apply with
  the Supabase MCP, keep the file in `setup/`.
- Commit trailer: `Co-Authored-By` + `Claude-Session` lines (see system reminder).
- Swift booking access (TakeOff only, **never Airport Parking Bay**): on 14 Oct the
  user said Swift confirmed there is no API and told them to use the login Swift
  gave, which supersedes the earlier "declined" note. The read-only sync is built in
  `supabase/functions/takeoff-bookings` (`swift.mjs` guarded client + planner,
  `index.ts`; setup 86; steps in its README) and runs by hand or on a schedule: Import →
  Booking import → Auto import → "Check bookings" (dry run, writes nothing) then "Import N bookings" (the page was redesigned and merged 14 Oct: Auto import / Manual import tabs, no provider name in the UI; setup 89 adds the import source to `recent_imports`, applied). 14 Oct fix: the site's product filter is `producttype` (our searches said `productype` and the site fell back to its default, so the 15th showed 31 instead of 125); TakeOff's saved searches were corrected in the DB. **State (14 Oct):
  setups 86 and 87 applied, setup 89, 90 and 91 applied, function `takeoff-bookings` v18 (15 Oct: Flight No. boxes read with or without quotes, hidden fields skipped; Diagnostics show the Return Report columns and 3 rows as read) v17 (14 Oct late: return flights from the Return Report, read one day at a time with `producttype`; it had sent the misspelt filter, so 16–18 Oct got 7 of 251 flights; Diagnostics show "Return flights: N of M drops matched") and `send-alerts` v18 deployed (14 Oct evening: From/To dates up to 14 days; Scheduled import: owners/managers save up to 6 London times and switch it on; at a time it checks and imports only if clean, i.e. nothing invalid, no review case not already on the open list, at most 200 changes, as the person who switched it on; otherwise nothing is imported and owners, managers and office get a push `import_held`, once per time; the user chose "Import if clean") (reads one day at a time, answers at once
  and keeps the connection alive, reads the export as plain text), TakeOff's config row saved (`manual_enabled`,
  scope `{all:true}`, no secrets), schedule off until an owner saves times (`enabled` = the schedule switch). The user added the login secrets and
  imported live once. RESOLVED: the 15th showed 31 instead of 125 because of the misspelt filter; the check now matches the site and prints "of N"
  (the site's own count) per day and stops if a download is shorter than that. Never ask for or accept the Swift
  password in chat (Supabase secrets `TAKEOFF_BOOKING_LOGIN` / `_PASSWORD` only).
  Known from the user's photos (14 Oct): every booking on that site is TakeOff's; pages
  `bookinglist-parkandride.php` and `arrival_report_parkandride.php`; flights come from the Return
  Report's HTML table. Pagination is not an issue at one day per search. Held for the office and Needs review rows (19 Oct) show the reg beside the reference, Open (the car's night, booking details or Removed cars) and, for a DROPS car moved to tonight or a later night, Move (EARLY RETURN for an earlier night, `set_return` for a later one; a moved hold is marked Done); test `HELD_ONLY=1 node run.mjs`. The user turns the schedule on themselves in the app.
- Unused: `companies.swipe_only` / `set_swipe_only()` (setup 64, superseded by
  per-person choice).

## Open ideas the user may ask for next
Swipe on picks; dark-mode check of Premium Board rows; "Next up" strip; long-wait
alert (Called > 20 min, optional Discord ping); shift handover note; search by part
of a reg; owner dashboard (cars/night, Called→Sent wait, no-shows, overstay income);
customer texts (~4p each); automatic import for Airport Parking Bay if they have an
export/API.

## Lane planner / Yard planner (setups 104 and 107 applied by Claude on 22–23 Oct 2026 at the user's request)
- **An add-on** (user, 23 Oct): only clients ticked in Parking Ops → Clients → Edit → "Yard planner (add-on)"
  (`brand.lane_planner`, saved by `admin_save_client` from setup 107) get it; the RPCs refuse
  others (`private.lane_planner_on`). Switching it off keeps their lanes. No client has it yet.
- Menu → Yard planner (every look, `lanePlanner()`). Source `src/app/16-lanes.js`, styles `public/lanes.css`.
- Setup 104: tables `parking_lanes`, `parking_positions` (select-only RLS per company, in
  realtime), RPCs `lane_get`, `lane_save`, `lane_move` (security definer in public like
  the other RPCs; no grant on the `private` schema), helper `private.lane_same_stay`.
  Owners/managers add areas; anyone but view-only confirms moves.
- A stay is one booking reference (its PICKS and DROPS rows), as on the dashboard; a
  repeat visit by the same reg has another ref and stays separate. Unplaced cars listed:
  PICKS taken in and due back within 14 days, DROPS in a parking yard with no PICKS
  car, neither SENT/CLEARED/removed (live: ~600 TakeOff cars, 45 ms).
- Positions count from the front exit: front only, both ends, or independent
  holding/temporary spaces. Moves check source access, reachable free destination,
  car revision and destination revision under a per-company lock. No location
  guesses, no offline writes. SENT/CLEAR never release a space; the row shows
  "Verify location". Area edit/remove is not built yet.
- Tests: `node checks/lane-planner.mjs` (PGlite), `LANES_ONLY=1 node run.mjs`, and
  `checks/lane-live.sql` (live, rolls itself back).


## Reviewed booking import (setup 111, takeoff-bookings v20, 24 Oct)
- From the user's review package (24 Oct, released at their request). Auto import: Today / 3 days / 7 days
  shortcuts, checkboxes per new/updated booking (`selected` keys checked by the edge against the fresh plan,
  `selectedBatches`), writes through `swift_apply_checked` (re-reads the bookings it writes inside the transaction).
  Manual import: several files at once (`src/app/13-manual-review.js`), read-only `reviewed_import_preview`, then
  `reviewed_import_apply` (selected keys, preview hash, idempotent request id); conflicts held, "Use incoming values"
  via `reviewed_import_resolve` (set_reg / set_return / set_pick_return). History `reviewed_import_history`
  (private.import_review_runs), undo preview `reviewed_import_undo_preview`, `recent_imports` returns run_id/files.
- Snapshots/hashes cover only what an import reads or protects; yards, board numbers, lanes, flight checks and a
  kept note don't make a preview stale (the package's first version hashed whole rows: every flight check would
  have refused the import). A booking with no registration (blank or ".") is imported and flagged, never invalid.
- Setup 111b (90-day trim of import_review_runs, holds a DELETE) is for the user's SQL editor; optional.
  Rollback `setup/rollback/111-*` after restoring the old frontend and takeoff-bookings v19. Docs
  `docs/import-review-upgrade.md`. Tests `node checks/reviewed-import.mjs`, `node --experimental-strip-types
  checks/import-edge.mjs`, `node checks/e2e/import-review-run.mjs`.
