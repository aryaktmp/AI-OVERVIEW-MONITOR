-- Migrasi 20261029070000_function_search_path.sql:
-- 1. Tetapkan search_path = public, pg_temp pada semua fungsi SECURITY DEFINER di schema public (claim_next_run_item, get_database_size_bytes, cleanup_old_checks_raw)
--    Implementasi menggunakan ALTER FUNCTION ... SET search_path = public, pg_temp tanpa menulis ulang badan fungsi.
-- 2. Pertahankan pembatasan hak EXECUTE: cabut dari PUBLIC, anon, authenticated; beri hak hanya kepada service_role
-- 3. Idempoten: aman dijalankan berulang kali tanpa galat

-- A. Fungsi klaim antrean atomik: claim_next_run_item
alter function public.claim_next_run_item(timestamptz) set search_path = public, pg_temp;

revoke all on function public.claim_next_run_item(timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_next_run_item(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_next_run_item(timestamptz) to service_role;

-- B. Fungsi pembacaan ukuran database: get_database_size_bytes
alter function public.get_database_size_bytes() set search_path = public, pg_temp;

revoke all on function public.get_database_size_bytes() from public, anon, authenticated;
revoke execute on function public.get_database_size_bytes() from public, anon, authenticated;
grant execute on function public.get_database_size_bytes() to service_role;

-- C. Fungsi pembersihan checks.raw kadaluarsa: cleanup_old_checks_raw
alter function public.cleanup_old_checks_raw(int) set search_path = public, pg_temp;

revoke all on function public.cleanup_old_checks_raw(int) from public, anon, authenticated;
revoke execute on function public.cleanup_old_checks_raw(int) from public, anon, authenticated;
grant execute on function public.cleanup_old_checks_raw(int) to service_role;
