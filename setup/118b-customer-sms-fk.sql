-- Parking Ops — database part 118b: the car link on customer_sms (with part 118).
-- Kept apart like 116b (the Supabase MCP hangs on the word for removing rows):
-- when a booking goes, its replies stay without the link. Safe to run twice.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customer_sms_booking_id_fkey') then
    alter table customer_sms add constraint customer_sms_booking_id_fkey foreign key (booking_id) references bookings(id) on delete set null;
  end if;
end $$;
