-- Rollback of part 149 (SQL editor). The app falls back to download_my_company() by itself.
drop function if exists download_my_company_part(text, text, int);
