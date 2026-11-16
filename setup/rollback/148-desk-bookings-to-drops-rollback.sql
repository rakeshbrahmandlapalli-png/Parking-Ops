-- Rollback of part 148 (SQL editor only): stop adding desk bookings to DROPS when a sheet is imported.
-- Cars it already added stay on their sheets (remove one in the app if needed).
drop trigger if exists sheets_desk_to_drops on sheets;
drop function if exists sheets_desk_to_drops();
drop function if exists desk_to_drops(uuid);
