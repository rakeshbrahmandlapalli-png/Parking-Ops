# Claude prompt — integrate and release notifications + push

Work in `rakeshbrahmandlapalli-png/takeoff-ops`. I have authorised you to integrate
the attached notification-centre and push-notification package, make the required
database changes and push/merge/deploy it once the checks pass. This is the
release instruction; do not stop at a plan or ask me to repeat this approval.

Read `README.md`, `VALIDATION.md` and the patch before editing. The package base
is `e8e0561dc6fcfea24669703183b28ba4d76f1e72`. Preserve all newer work, including
the flight/yard persistence fix, calls, imports, lanes, keys, collections, voice
and the existing looks. Work on a branch and use `git apply --check`. If main has
changed, reconcile the source changes; do not overwrite the repository with the
included source-files folder. Edit `src/app/` and regenerate `public/app.js`.

Finish the complete release:

1. Review the implementation and hosted schema read-only. Confirm existing
   parts 93, 104 and 123 and their prerequisites, actual deployed function
   versions, existing VAPID configuration and the long-wait cron. Keep secrets
   in the existing secret store. Do not rotate keys or add a duplicate timer.
2. Create the next migration using the CLI and incorporate candidate
   `schema.sql` **followed by** `push-schema.sql`. Test in an isolated database,
   run security advisors and check all new public/service function grants.
   Private queue/receipt tables must not be directly accessible to browsers.
   Verify tenant isolation and the existing me()/can() identity model.
3. Run the documented checks with the pinned test dependencies. Include the
   new database, push queue, sender, worker and actual-browser suites, existing
   long-wait/AT DESK/health/call regressions, and the repo's required release
   checks. Confirm generated-bundle parity and no accidental changes to the
   eight looks. Inspect any failures and fix them before release.
4. Apply the reviewed migration. Deploy the updated `send-alerts` with its
   existing authentication configuration, then the web app. Check the queue
   RPCs are reachable by service role only and the browser can call only its
   authorised read/action/settings/device-status RPCs. Check service-worker
   updates and `/notifications.css` caching. Record exact migration/function/
   deployment versions and the final commit.
5. Verify with fictional records in a dedicated test tenant: unread and filter
   counts; direct push-to-alert and booking links; two simultaneous acceptances;
   dispatch assignment; release; automatic resolution; physical missing-key
   and front/both-end lane cases; supervisor escalation; an expired call;
   disabled access; per-device tests with DROPS off; pause/resume; retryable and
   permanent failures; sign-out/reassignment on a shared phone; and old/missing
   optional schema behaviour. Do not send test Discord posts or customer texts,
   make calls, move real vehicles or alter live customer/payment records.
6. For real-device acceptance use an authorised internal account/device: Chrome
   on Android and an installed iOS Home Screen app when available; app open,
   background and locked; network loss/reconnect; battery restrictions;
   subscription renewal; disabled permission and re-enable. Report provider
   acceptance separately from observed display. If no handset is available,
   identify that boundary plainly instead of claiming physical delivery passed.
7. Push/merge and complete the authorised deployment after the code/database
   checks pass. Return the live URL, commit, database migration, function version,
   exact test results and outstanding device-only checks. If deployment is
   blocked by missing credentials or a genuine failed check, explain the exact
   blocker. Do not silently claim it is live or enterprise certified.

Keep acceptance distinct from SENT/RTC. Preserve payment-role controls and call
permissions. Do not create a fake attendance/shift integration, generic flight
arrival alerts, new paid infrastructure or an unrelated native APK. No phone
forwarding, customer-SMS automation or company-wide Discord configuration change
is part of this release. Use the README rollback sequence if a release fails,
retaining notification history and all existing operational data.
