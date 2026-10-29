# Attendance release review — NOT approved for production

Production writes, environment changes, deployment, merging and enrolment remain
blocked. Zero downtime and preservation of all parking workflows are mandatory.
This document is a review package, not an instruction to execute the commands.

## Verified target and reviewed baseline

- Supabase: `oioqjfrlwrjovnouhusp`, Ops, eu-west-1, ACTIVE_HEALTHY. The deployed
  `https://takeoff-ops.vercel.app/app.js` independently references this exact ref.
  Observed bundle SHA256:
  `157a2109319aa1c99cc0818417cb6c8705f9786c91ca0950c134b2a0ce84be1d`.
- Never target `oyakdccjpyonfnomhgow`; no changes to the separate Attendance project.
- Starting PR heads: Parking-Ops #165 `6448c6b4f902351a66648a3c4b3053b6552cd0ca`;
  aero-attendance #4 `adf53df2a601b63fe9966341aa6a18a623c8e3eb`.
- Current Parking main is `36c511f`, adding #166/#167 booking-import fixes absent
  from that PR head. A detached local staging overlay applies cleanly and the
  generated bundle agrees. **Do not deploy the old PR head**. Integrate the current
  main changes into a new reviewed PR head and rerun all checks before approval.
- Vercel project IDs inherited from the GitHub integration:
  Parking `prj_Ll3pMLhK1tF1ur4CcpV8H1vSQQ7m`, Attendance
  `prj_qFGOoxuRD70ujpaepkl9LGR9huAv`, team
  `team_zsuQ086XKtFoVsAjg76W946Y`. API verification returns 403. Domain/project,
  current production commit and production rollback deployment must be verified
  after team access is granted. Public domain reachability alone is insufficient.

## Read-only production inspection

Migration history includes `attendance_addon_foundation` at `20261028001740`.
Later parking migrations `import_snapshot_scope_130` and `put_back_rebooked_131`
are already applied. Numbered filenames are NOT migration identities.
`public.attendance_staff_links` exists; namespaced `aero_*` tables were not found.
Both TAKEOFF and Airport Parking Bay currently have Attendance false.

Recorded function-definition MD5 baselines:

Aggregate catalog snapshots: parking functions `4297946dbc268434da5aa97926db20df`;
parking column metadata `38b58f465f8379146f770dba927a454a`. Existing `pg_cron`,
`pg_net` and `pgcrypto` extensions were confirmed read-only.

| Function | MD5 |
| --- | --- |
| admin_save_client(jsonb) | b5ec57beb85a851f241c66e636be26f6 |
| can(text) | 1743ad495454fd4b6ffcc356463cc741 |
| me() | 0053c02733d94b6c8306d144ff7a2157 |
| ops_notification_feed() | b8a1bdaadcd05b8b182c126e5f967af8 |
| record_topup(jsonb) | 2f134e5b637ee6aa3d3085e84dd85585 |

Security advisor: 2 mutable-search-path findings (`public.early_at_for`,
`private.lane_same_stay`), 5 anonymously executable security-definer functions,
130 authenticated security-definer findings, leaked-password protection disabled,
and 16 informational RLS-without-policy findings. Some can be intentional; none
has been waived or changed. Review ownership, grants and internal auth checks
individually; never blanket-revoke working parking APIs. Performance advisor also
reports unindexed FKs and other findings requiring review, not automatic changes.
See https://supabase.com/docs/guides/database/database-linter .

## Backup and restore evidence

- Read-only database evidence: 14 nightly in-project backups, oldest 22 October,
  latest `2026-10-28 03:15:00.075873+00`, 237,516,592 retained bytes; both active
  clients have a backup within 25 hours. Cron `parking-ops-backups` is active at
  `15 3 * * *`. These backups do not protect against losing the project itself.
- User-supplied dashboard evidence: successful PHYSICAL backup 28 October 2026
  05:17:42 UTC; preceding 27 October 05:17:36 and 26 October 05:16:27 UTC.
  This evidence has not been independently inspected through the connected API.
- PITR unverified. Database physical backups exclude Storage object bytes.
- Local synthetic database archive/restore and Attendance restore round-trip
  pass. They do NOT establish restoration of the production physical backup.
- **Required before writes:** a supported restore-to-new-project rehearsal, or
  an explicitly accepted recovery plan. Isolate network egress and scheduled
  jobs before opening a restored copy; never let restored jobs contact live
  senders/integrations. Verify row counts, constraints, Auth identity continuity,
  parking workflows and independent Storage/R2 object recovery. Record recovery
  point, artifact/reference, restored project, timestamps, RTO/RPO and reviewer.
  No such completed production-backup restore evidence currently exists.

## Candidate migration order and effects

Do not reapply foundation 130, and NEVER apply prototype 133. After validating
the live object definitions against the reviewed scripts, the candidate order is:

1. `setup/134-attendance-identity.sql`: new Attendance identity/link/context APIs;
   no parking password, role, active flag or company UUID changes.
2. `setup/135-attendance-pilot.sql`: private release/tester tables, explicit
   server-side default-deny tester gate and Attendance link policy. Enrols nobody.
3. `setup/136-attendance-shared.sql`: namespaced Attendance schema, RLS/grants,
   company FK, clock/break/correction/audit APIs and finish-only endpoints.
   Creates extensions if absent; installs no push destination or timer.

Run `node src/build-attendance.mjs --check` before review. Inspect extension and
privilege prerequisites read-only before applying. Use distinct Attendance
migration names, not the already-used parking 130/131 names. Apply each reviewed
file as its own transaction with bounded lock/statement timeouts and stop on error.
For an approved operator session, the command shape is:

```sh
PGOPTIONS='-c lock_timeout=1s -c statement_timeout=60s' \
  psql "$PARKING_OPS_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f setup/134-attendance-identity.sql
# Repeat only on success for 132, then 134; record migration history correctly.
```

This is not approval to use psql or bypass migration bookkeeping. Rehearse the
exact supported deployment mechanism first. FK/DDL locks can contend with company
writes; zero downtime is not proven by idempotent SQL alone. Abort and roll back
on contention rather than waiting on active clients. Compare parking definition
hashes/grants and workflows before/after; do not replace existing parking APIs.

## Rollback and kill switch — proposed commands, not executed in production

Before 134 exists, the 132 rollback can disable testers/release access. After 134,
the reviewed data-preserving emergency stop is:

```sh
psql "$PARKING_OPS_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f setup/rollback/136-attendance-shared-rollback.sql
```

It disables Attendance testers, forces pilot gating and revokes pilot provisioning.
It retains links, shifts, breaks, corrections and finish-only clock-out; parking
staff/logins/workflows remain unchanged. Local rehearsal verifies revocation,
record retention and closing an open break/shift. Do not run 131's function-drop
rollback against later dependent objects. Do not drop Attendance tables or restore
an old whole production DB over active parking writes.

Pause only Attendance jobs/destinations if subsequently configured. Roll back
only the new Attendance frontend/functions to recorded immutable deployments,
retain finish-only access for open-shift owners, and preserve all records.
Never roll back newer parking fixes. Exact Vercel rollback IDs remain unverified.

## Pilot identity — unresolved approval item

TAKEOFF company UUID: `16360443-4ca3-41f6-bd77-d0b03d00ed79`.
Two active individual owner identities exist; neither is enrolled:

| Account | Staff UUID | Auth UUID |
| --- | --- | --- |
| RAKESH | 53a6f3f6-0dac-4738-bc5b-799a331feaa7 | 8eeefabe-2cea-4b66-87ec-a83f777c6c56 |
| Rakesh (Parking Ops) | a8624ab5-1176-488c-afe1-951039d59274 | 6642d9f8-4087-4399-9d75-a1e5fc660144 |

Confirm the first account explicitly by UUID before any activation. Do not select
by display name alone, enrol both, create another Auth identity, or change passwords.

## Deployment, monitoring and final approval gates

1. Finish Step 6 physical checks and resolve security findings. Verify backup
   recovery, targets and immutable rollback artifacts. Incorporate newer parking
   fixes into reviewed PR heads, run full regressions, and pin exact trees/SHAs.
2. Present one final approval package with all evidence and the one pilot UUID.
   No production action is authorized by this document or earlier combined steps.
3. After approval only: apply reviewed migrations with all tenants still disabled;
   verify no parking drift and default denial. Deploy only the new Attendance
   functions, preserving all existing function JWT settings. Stage the frontend
   from the exact reviewed head; verify API/relationship/auth acceptance before
   promotion. Deploy the parking entry only after Attendance is ready.
4. Configure Attendance-only push/VAPID/jobs separately after recipient isolation
   is proven. Enrol exactly the approved RAKESH UUID at TAKEOFF. No other client
   or staff activation, and no wider rollout.
5. Merge only when required checks pass and deployed production commit/tree
   provenance exactly matches reviewed heads; merging must not trigger a different
   unreviewed build. Vercel branch deployment suppression remains in place.
6. Monitor parking login, booking/import calls, DB lock waits/latency/errors,
   company settings and row-count/definition baselines alongside Attendance auth,
   clocking, correction/audit and push recipient/delivery errors. Record launch
   baseline and observations continuously through activation, at 15/60 minutes,
   daily during the seven-day pilot and after any recovery action. On degradation,
   freeze activation and use the scoped kill switch; never change unrelated APIs.

Physical Android/iPhone PWA install/reopen, real push delivery, GPS accuracy,
airplane mode, background/resume and recovery are UNPERFORMED. No physical-phone
or live-API acceptance is claimed. Production approval is **not ready**.

## Local/staging regression evidence

- Step 5 scoped gate: 225 counted checks plus transport/handoff and all responsive
  staff/manager journeys passed again.
- Legacy isolation: 455/455; synthetic backup round-trip: 53/53; shared SQL repeat
  installation, recipient isolation, correction/audit and revocation checks pass.
- New readiness test: 27 synthetic notification/PWA/GPS/kill-switch/archive-restore
  checks pass. Physical delivery/device checks remain unperformed.
- Parking SQL regressions pass: 60 client-settings checks plus identity/pilot/
  clocking/isolation, top-up 73, call workflow 15, notification clear 26,
  reviewed import 43 and save-moves-staying-longer checks.
- A detached staging overlay on current main `36c511f` applies cleanly, builds
  consistently and passes reviewed-import 43 plus save-moves-staying-longer.
- Full parking Chromium regressions **do not pass**: PR checkout reported
  790 passed/359 failed, staging overlay reported 782 passed/363 failed and the
  staging command reached its 580-second timeout (exit 124). Failures include
  an Operations PICKS date/flight assertion and DROPS-by-hour boundary assertion,
  followed by browser/context termination failures. Some fixtures hardcode
  `+01:00` despite the current post-DST date. These require isolated baseline
  reproduction and triage; they have NOT been waived as harmless or attributed
  to production without proof. Partial passing results do not satisfy the
  existing-client regression gate.

Raw logs are retained under `/tmp/attendance-release/`. No cloud staging restore,
production migration, release, environment change, merge or activation was run.
