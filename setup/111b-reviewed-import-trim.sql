-- 111b: keep reviewed-import run details for 90 days. Run in the SQL editor (it holds a DELETE, which the
-- Supabase MCP refuses). Optional: nothing depends on it; the runs are small and only grow by one per import.
create or replace function private.trim_import_review_runs() returns void
language sql security definer set search_path=public,pg_temp as $$
  delete from private.import_review_runs where at < now() - interval '90 days';
$$;
revoke all on function private.trim_import_review_runs() from public, anon, authenticated;
select cron.schedule('import-review-runs-trim', '17 3 * * *', 'select private.trim_import_review_runs()');
