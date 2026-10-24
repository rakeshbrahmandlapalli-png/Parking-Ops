-- Parking Ops — part 119: PIN sign-in found no crypt().
-- Part 108 gave staff_login_check and change_my_pin "search_path = public", but pgcrypto
-- lives in the extensions schema, so every PIN check failed with
-- "function crypt(text, text) does not exist". Applied 24 Oct 2026 (Claude, at the user's request).
alter function public.staff_login_check(text, text) set search_path = public, extensions;
alter function public.change_my_pin(text, text) set search_path = public, extensions;
