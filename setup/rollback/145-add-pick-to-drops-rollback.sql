-- Rollback of part 145 (ADD TO DROPS from a PICKS car). For the SQL editor.
-- Restore the app without the "Add to DROPS" button first. Cars already added stay where they are.
drop function if exists put_pick_on_drops(uuid, date);
