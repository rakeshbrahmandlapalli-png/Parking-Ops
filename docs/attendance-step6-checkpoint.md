# Step 6 follow-up — local checks passed, browser/phone acceptance pending

This section supersedes the historical checkpoint below. Production release is
still blocked. No merge, production deployment, Supabase write, environment
change, Attendance enablement or pilot activation was performed. Automatic
preview deployment suppression remains unchanged; current-head preview testing
is pending under the latest instruction to skip listener tests and not deploy.

## Incorporated fixes

Reviewed and cherry-picked the required changes from Parking-Ops PRs #166–#169
onto attendance-integration, without merging or rebasing main:

- #166: restrict import undo snapshots to the relevant sheet/reference/registration.
- #167: restore a rebooked no-show/cancellation through import review.
- #168: clear stale Importing state and poll while the server reports a running import.
- #169: carry an explicitly corrected PICKS registration into a later imported DROPS car.

Setup 130/131/132 and their rollback scripts are included as source only. No SQL
was applied to Supabase. Existing shared Attendance changes were preserved.

## Browser corrections and outstanding acceptance

The PICKS return-date assertion now expects the existing comma-free format.
The DROPS 17:30/17:31 fixture constructs instants in an explicitly configured
Europe/London browser zone, handling both GMT and BST instead of hardcoding +01.

The previous full run was wrapped in a 580-second external timeout; its exit 124
and browser-closure cascade do not establish independent product failures. The
runner now uses fresh processes/browsers per section, two workers, aggregate
summaries, explicit signal failure and missing-summary detection. A disconnected
browser aborts its section instead of producing repeated new-context failures.
No test sections are skipped by this change. STRESS and screenshot modes remain.
These runner changes have passed syntax checks but remain browser-unverified.

A rerun attempted in the restricted sandbox could not open its localhost HTTP
listener (`listen EPERM: operation not permitted 127.0.0.1`); all 25 sections
were correctly reported incomplete, with zero accepted assertions. Subsequent
permission attempts did not complete. The user then explicitly deferred the
localhost browser suite. **No full browser pass or confirmed closure resolution
is claimed.** Re-run `CHROMIUM=/usr/bin/chromium node checks/e2e/run.mjs` with
localhost allowed; do not impose the previous 580-second global timeout.

## Verified non-browser checks

All 48 `checks/*.mjs` scripts pass with Node 24, including the three new import
SQL regression scripts and Attendance access/add-on checks, using synthetic or
local PGlite data. Both generated bundles match maintained sources. Changed E2E
modules parse and `git diff --check` passes. Logs are under
`/tmp/attendance-regression/` in this workspace. A full Step 5/6 browser gate is
not implied by these results.

## Remaining physical-phone checks

On physical Android and iPhone: staff and manager PWA installation/separate
icons, launch/relaunch and session separation; push permission, foreground and
background delivery/tap routing; GPS inside/outside site, denied permission and
poor accuracy; offline/airplane-mode, timeout/lost-response retry and recovery;
revoked-access finish-only behavior. These require a separately authorised
isolated test setup. Neither TAKEOFF identity is activated.

Backup restore rehearsal/PITR/Storage recovery, security-advisor triage, browser
regressions, current-head preview acceptance and explicit pilot UUID approval
remain release gates. The historical observations below are not current-head
acceptance evidence.

---

# Safe Step 6 checkpoint — release blocked

No production database writes, migrations, environment-variable changes,
deployment, promotion, rollback, merge, rebase or pilot activation were performed.
The separate Attendance Supabase project was not changed. Both client Attendance
flags were observed false during the earlier authorised read-only inspection.

## Preserved changes

Parking-Ops: `docs/attendance-release-approval.md`, the detailed release/recovery
review. Aero: `checks/release-readiness.mjs` and `checks/RELEASE-READINESS.md`,
synthetic readiness checks and an explicitly unperformed phone checklist.
No application runtime, schema, migration or parking workflow code changed.
The checkpoint adds this report as well. Original local commits are retained at
`refs/checkpoints/step6-original-local` in each repository. API-published trees
must exactly match the local committed trees before branch synchronization.

## Vercel verified read-only — supersedes earlier access blockers

Connected lookup by `takeoff-ops` without the previous explicit team selector
succeeds. Returned account ID is `team_zsuQ086XKtFoVsAjg76W946Y`, project ID
`prj_Ll3pMLhK1tF1ur4CcpV8H1vSQQ7m`. The user's dashboard describes this as the
personal Hobby scope; use the returned identifiers rather than assuming another
team based on a label.

- `parking-ops.vercel.app` is verified for that project, without redirect.
- Production: READY, main `714306b0938f797ed510ddb4681e22c8567b045c`, deployment
  `dpl_6FQbmaJgtikYNZkJwXekLLhBPK82`. Domain lookup of the deployment confirms
  `parking-ops.vercel.app`, `takeoff-ops.vercel.app` and `parkingbay-ops.vercel.app`
  as aliases of this same production deployment.
- PR #165 preview: READY, deployment `dpl_Dbedzc2iBgQhRgNyzkZKBDwGyqa9`, URL
  `https://takeoff-fcsw4ql58-rakeshbrahmandlapalli-pngs-projects.vercel.app`,
  commit `1a64398967e5f8a750381bd6fde3593deab49a6c`. It is an OLD checkpoint,
  not the current PR head. Do not treat it as acceptance of newer commits.
- Current production bundle SHA256:
  `a39b6653381757b9fb74c19757e4a5f898e73f2955ad1da56e1f1a753ea4f8aa`.
  Its sole Supabase endpoint is `https://oioqjfrlwrjovnouhusp.supabase.co`.

## Newer main fixes missing from the Parking PR

Compared against fetched main `714306b` (no merge/rebase):

| PR | Commit | Missing fix |
| --- | --- | --- |
| #166 | 39287d95dbb3422555ee3ce70049ca909fe5be5b | Seven-day booking-import timeout / snapshot scope (parking setup 130) |
| #167 | 36c511f38e45f7ccd0fc33c3ff97207849e931d2 | Restore a rebooked no-show to DROPS from import review (parking setup 131) |
| #168 | 589609e6129e81e3242bf3c3dcf6c60b83b33beb | Clear stale "Importing…" state after a lost import result |
| #169 | 714306b0938f797ed510ddb4681e22c8567b045c | Carry a reg corrected on PICKS to a DROPS car imported later (parking setup 132) |

The earlier detached staging overlay was based on `36c511f`, not the newest main.
It is not approval to ship a branch missing #168/#169. Parking numeric setup
130/131/132 must not be confused with Attendance files or migration identities.

## Individual browser reproductions

Original assertions and fixtures are unchanged. Temporary runners extract one
scenario at a time and use fresh local Chromium with mocked services.

1. `checks/e2e/sections/01-sign-in-and-looks.mjs:618`:
   **Ops wide PICKS: arrival, car, customer, return and return flight**.
   Expected return date matches `^\w{3}, \d+ \w{3} 09:05 NEXT$` (comma required).
   Observed `Thu 29 Oct 09:05 NEXT` (no comma). Other printed values:
   `08:15`; `PB22BBB #2 AUDI A4 AVANT S LINE`;
   `BAKER MR TKO-2026-2002`; pk3 return flight `Not given`.
   Isolated scenario completes with exactly one failed assertion.
2. `checks/e2e/sections/05-import.mjs:448`:
   **DROPS by hour: 17:30 counts as morning, 17:31 as night**.
   Expected morning 1/night 2; observed morning 2/night 1. Fixtures explicitly use
   `2026-10-28T17:30:00+01:00` and `17:31:00+01:00`. London is UTC+00 on this
   date, so these instants are 16:30/16:31 local. Isolated scenario fails once.
   This is a fixture-offset concern, not evidence to change production time maths.
3. Full-run closure errors, verbatim:
   `page.waitForSelector: Target page, context or browser has been closed` and
   `browser.newContext: Target page, context or browser has been closed`.
   They cascade after Exit fee standard checks. The immediately implicated Exit
   fee scenario was extracted and rerun alone: all checks pass, browser remains
   connected, and a new-context/new-page probe passes. Closure is **not reproduced
   in that isolated scenario**; the full-run resource/timeout cause is unresolved.
   Do not classify hundreds of closure cascades as independent product failures.

Logs/runners: `/tmp/attendance-release/repro-{picks,drops,browser-closure}.*`.
Full-suite logs remain available. No full parking browser pass is claimed.

Both assertion failures also reproduce individually against the untouched
`origin/main` public files at `714306b`, selected through the harness's `APP_ROOT`.
Each baseline scenario fails once. Logs: `baseline-repro-picks.log` and
`baseline-repro-drops.log` under the same directory. This establishes their
presence without the Attendance patch; it does not waive them as release gates.

## TAKEOFF identities — neither activated

Company `16360443-4ca3-41f6-bd77-d0b03d00ed79` (TAKEOFF).

| Safe label | Staff UUID | Auth UUID | Role / status |
| --- | --- | --- | --- |
| RAKESH | 53a6f3f6-0dac-4738-bc5b-799a331feaa7 | 8eeefabe-2cea-4b66-87ec-a83f777c6c56 | owner; active; not removed; zero desk names; Auth identity exists |
| Rakesh (Parking Ops) | a8624ab5-1176-488c-afe1-951039d59274 | 6642d9f8-4087-4399-9d75-a1e5fc660144 | owner; active; not removed; zero desk names; Auth identity exists |

Labels and UUIDs safely distinguish these accounts without exposing email.
Confirm the intended UUID explicitly before any future enrolment.

## Remaining blockers

Production-backup restore rehearsal/PITR/Storage recovery evidence; physical
Android/iPhone PWA/push/GPS/recovery acceptance; security-advisor triage;
clean existing-client browser regressions; incorporation and re-verification of
the four missing main fixes; current-head preview/live API acceptance; and exact
pilot identity approval. The detailed release review remains a proposal, not
production authorization. Stop at this checkpoint.
