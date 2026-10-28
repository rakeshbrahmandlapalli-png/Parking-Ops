-- Rollback of part 131 (put a rebooked no-show back on DROPS). For the SQL editor.
-- Restore the app without the "Put back on DROPS" button first. Cars already put back stay where they are.
drop function if exists put_back_rebooked(uuid, text, text);
