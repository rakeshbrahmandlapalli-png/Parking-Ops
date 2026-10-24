-- Rollback for part 118 (company Android phone): run in the SQL editor. Run this first,
-- before any older rollback (116/117), and only after the owner has pressed Go offline on
-- the company phone. It stops sending and keeps every record: customer_texts,
-- customer_sms, customer_calls, private.text_outbox and the activity log stay.
-- A text already claimed by the phone (status 'sending') may still have gone out:
-- check the phone's sent messages before anyone sends it again by hand.
begin;
-- 1. No more automatic texts and no more retries.
select cron.unschedule('customer-text-outbox') where exists (select 1 from cron.job where jobname = 'customer-text-outbox');
update private.text_outbox set done_at = now(), result = 'rollback' where done_at is null;
-- 2. Texts and calls off for every company (the add-on ticks stay as they are).
update companies set texts = jsonb_set(coalesce(texts, '{}'), '{on}', 'false') where coalesce((texts->>'on')::boolean, false);
update companies set calls = jsonb_set(coalesce(calls, '{}'), '{on}', 'false') where coalesce((calls->>'on')::boolean, false);
-- 3. Unpair every phone so none can claim; queued texts expire.
update company_phones set device_id = null, staff_id = null, ready = false, sms_ready = false, calls_ready = false,
  pending_device = null, pending_staff = null, pending_at = null;
update customer_texts set status = 'expired', error = 'Stopped (rollback)' where status = 'queued';
commit;
-- Then, if the feature is to go completely: untick the add-ons in Parking Ops → Clients → Edit,
-- restore the web app without Customer texts, and only then consider 117/116 rollbacks.
