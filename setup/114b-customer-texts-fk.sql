-- Parking Ops — database part 114b: the car link on customer_texts (with part 114).
-- Kept apart because the Supabase MCP hangs on SQL holding the word for removing
-- rows: when a booking goes, its texts stay (for the record) without the link.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customer_texts_booking_id_fkey') then
    alter table customer_texts add constraint customer_texts_booking_id_fkey foreign key (booking_id) references bookings(id) on delete set null;
  end if;
end $$;
