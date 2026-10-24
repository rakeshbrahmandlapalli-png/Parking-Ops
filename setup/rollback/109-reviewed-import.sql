-- PREPARED ONLY. Run only with the owner's approval and AFTER restoring the
-- preceding frontend and takeoff-bookings edge code. Retains audit data.
revoke execute on function reviewed_import_preview(jsonb) from authenticated;
revoke execute on function reviewed_import_apply(jsonb,text,text[],uuid,jsonb) from authenticated;
revoke execute on function reviewed_import_resolve(jsonb,text,text) from authenticated;
revoke execute on function reviewed_import_history() from authenticated;
revoke execute on function reviewed_import_undo_preview(bigint) from authenticated;
revoke execute on function import_review_existing(uuid,text[]) from service_role;
revoke execute on function swift_apply_checked(uuid,jsonb,jsonb,text[],jsonb,uuid) from service_role;
-- recent_imports retains its backward-compatible fields. The additive ledger
-- and read helper do not affect old clients. No booking/history rows are deleted.
