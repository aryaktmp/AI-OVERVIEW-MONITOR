-- Migrasi Perbaikan Fase 3 (Bagian A):
-- 1. Cabut hak EXECUTE pada fungsi claim_next_run_item dari PUBLIC, anon, dan authenticated; beri hanya ke service_role.
-- 2. Tambahkan kolom is_demo boolean default false pada check_runs dan tandai run dry-run lama sebagai is_demo = true.

revoke all on function public.claim_next_run_item(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_next_run_item(timestamptz) to service_role;

alter table check_runs
  add column if not exists is_demo boolean not null default false;

update check_runs
set is_demo = true
where id in (
  select distinct run_id
  from checks
  where coalesce((raw->>'dry_run')::boolean, false) = true
);
