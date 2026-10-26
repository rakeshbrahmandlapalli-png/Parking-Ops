-- Optional API disable AFTER restoring the previous app and Edge Function.
-- Additive data is deliberately retained. No old alert API is changed.
begin;
revoke execute on function public.ops_notification_feed(),public.ops_notification_action(uuid,text,uuid),public.set_ops_notification_options(integer,boolean),public.ops_push_device_status(text) from authenticated;
revoke execute on function public.record_ops_notification(uuid[],text,text,text,text,uuid,text),public.ops_notification_delivery(uuid[]),public.ops_notification_escalations(),public.ops_notification_candidates(),public.ops_notification_trim(),public.ops_push_enqueue(uuid[],text,text,jsonb,integer,text,text),public.ops_push_claim(text),public.ops_push_result(uuid,uuid,boolean,integer) from service_role;
commit;
