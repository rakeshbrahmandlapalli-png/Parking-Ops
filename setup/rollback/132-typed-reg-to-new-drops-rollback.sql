-- Rollback of part 132 (a reg changed on PICKS reaches a DROPS car imported later). For the SQL editor.
-- Regs already carried stay as they are.
drop trigger if exists bookings_reg_in on bookings;
drop function if exists bookings_reg_in();
drop function if exists carry_reg_from_picks(uuid);
