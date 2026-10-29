-- Migrasi Perbaikan Fase 4 (Bagian A):
-- 1. Kolom is_demo pada keyword_groups, keywords, dan competitors + penandaan data seeder yang sudah ada
-- 2. Fungsi SQL get_database_size_bytes() dan cleanup_old_checks_raw() hanya untuk service_role

alter table keyword_groups
  add column if not exists is_demo boolean not null default false;

alter table keywords
  add column if not exists is_demo boolean not null default false;

alter table competitors
  add column if not exists is_demo boolean not null default false;

-- Tandai grup contoh yang dibuat oleh seeder
update keyword_groups
set is_demo = true
where name in (
  'Produk HR',
  'Panduan HR',
  'Perbandingan',
  'Merek',
  'Umum'
);

-- Tandai keyword contoh yang dibuat oleh seeder / dry-run lokal
update keywords
set is_demo = true
where text in (
  'software hr terbaik',
  'aplikasi hris indonesia',
  'software payroll terbaik',
  'aplikasi absensi karyawan',
  'software rekrutmen terbaik',
  'apa itu hris',
  'cara hitung pph 21 karyawan',
  'cara mengelola cuti karyawan',
  'cara membuat slip gaji',
  'hris vs hrms',
  'hris lokal vs global',
  'payroll manual vs software',
  'linovhr',
  'review linovhr',
  'harga linovhr',
  'linovhr vs aplikasi hr lain',
  'software manajemen proyek terbaik',
  'aplikasi akuntansi terbaik',
  'cara meningkatkan produktivitas tim',
  'software hris indonesia',
  'aplikasi absensi online',
  'aplikasi slip gaji karyawan',
  'sistem manajemen sdm',
  'aplikasi penilaian kinerja karyawan'
);

-- Tandai kompetitor contoh yang dibuat oleh seeder
update competitors
set is_demo = true
where domain in (
  'hrisku.id',
  'payrollpintar.com',
  'timesheet.co.id',
  'blogsdm.id',
  'kerjaplus.com'
);

-- Fungsi SQL untuk membaca ukuran database saat ini (dalam byte)
create or replace function public.get_database_size_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database())::bigint;
$$;

revoke execute on function public.get_database_size_bytes() from public, anon, authenticated;
grant execute on function public.get_database_size_bytes() to service_role;

-- Fungsi SQL untuk mengosongkan kolom checks.raw yang lebih tua dari N hari
create or replace function public.cleanup_old_checks_raw(retention_days int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_rows int;
begin
  update checks
  set raw = null
  where raw is not null
    and checked_at < (now() - make_interval(days => retention_days));

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

revoke execute on function public.cleanup_old_checks_raw(int) from public, anon, authenticated;
grant execute on function public.cleanup_old_checks_raw(int) to service_role;
