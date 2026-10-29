-- Migrasi 20261029070000_function_search_path.sql:
-- 1. Tetapkan search_path = public, pg_temp pada semua fungsi SECURITY DEFINER di schema public (claim_next_run_item, get_database_size_bytes, cleanup_old_checks_raw)
-- 2. Pastikan seluruh fungsi memakai prefix public. pada nama tabel/fungsi
-- 3. Pertahankan pembatasan hak EXECUTE: cabut dari PUBLIC, anon, authenticated; beri hak hanya kepada service_role
-- 4. Idempoten: aman dijalankan berulang kali tanpa galat

-- A. Fungsi klaim antrean atomik: claim_next_run_item
create or replace function public.claim_next_run_item(max_backoff_cutoff timestamptz default now())
returns setof public.run_items
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.run_items
  set state = 'processing',
      updated_at = now()
  where id = (
    select id
    from public.run_items
    where state = 'pending'
      and (attempts = 0 or updated_at <= max_backoff_cutoff)
    order by updated_at asc
    for update skip locked
    limit 1
  )
  returning *;
$$;

revoke all on function public.claim_next_run_item(timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_next_run_item(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_next_run_item(timestamptz) to service_role;

-- B. Fungsi pembacaan ukuran database: get_database_size_bytes
create or replace function public.get_database_size_bytes()
returns bigint
language sql
security definer
set search_path = public, pg_temp
as $$
  select pg_database_size(current_database())::bigint;
$$;

revoke all on function public.get_database_size_bytes() from public, anon, authenticated;
revoke execute on function public.get_database_size_bytes() from public, anon, authenticated;
grant execute on function public.get_database_size_bytes() to service_role;

-- C. Fungsi pembersihan checks.raw kadaluarsa: cleanup_old_checks_raw
create or replace function public.cleanup_old_checks_raw(retention_days int default 90)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected_rows int;
begin
  update public.checks
  set raw = null
  where raw is not null
    and checked_at < (now() - make_interval(days => retention_days));

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

revoke all on function public.cleanup_old_checks_raw(int) from public, anon, authenticated;
revoke execute on function public.cleanup_old_checks_raw(int) from public, anon, authenticated;
grant execute on function public.cleanup_old_checks_raw(int) to service_role;
