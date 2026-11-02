-- Migrasi 20261102010000_keyword_batches.sql:
-- Fase Data: Penjadwalan Batch Keyword Mingguan
-- 1. Tabel keyword_batches untuk mengelompokkan keyword dan rotasi berkala.
-- 2. Menghubungkan keywords dengan keyword_batches via kolom batch_id (foreign key).
-- 3. Tabel batch_schedule_settings untuk kontrol rotasi otomatis vs override manual.
-- 4. Tabel batch_audit_logs untuk audit trail perubahan batch aktif.
-- 5. Indeks dan Row Level Security (RLS) untuk akses pengguna terautentikasi.

create table if not exists keyword_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  order_index int not null unique,
  is_active boolean not null default false,
  is_enabled boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indeks unik parsial: memastikan maksimal hanya ada SATU batch yang berstatus aktif (is_active = true)
create unique index if not exists keyword_batches_single_active_idx
  on keyword_batches (is_active)
  where is_active = true;

-- Hubungkan tabel keywords dengan keyword_batches
alter table keywords
  add column if not exists batch_id uuid references keyword_batches(id) on delete set null;

-- Indeks untuk pencarian dan pemrosesan antrean per batch
create index if not exists keywords_batch_id_idx on keywords (batch_id);
create index if not exists keywords_batch_id_active_idx on keywords (batch_id, active);

-- Tabel konfigurasi penjadwalan & override manual
create table if not exists batch_schedule_settings (
  id int primary key default 1,
  mode text not null default 'auto',
  override_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Tabel audit trail pergantian batch
create table if not exists batch_audit_logs (
  id uuid primary key default gen_random_uuid(),
  previous_batch_id uuid references keyword_batches(id) on delete set null,
  new_batch_id uuid references keyword_batches(id) on delete set null,
  trigger_type text not null,
  actor_id text not null default 'system',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists batch_audit_logs_created_at_idx
  on batch_audit_logs (created_at desc);

-- Aktifkan Row Level Security (RLS) di tabel-tabel baru
alter table keyword_batches enable row level security;
alter table batch_schedule_settings enable row level security;
alter table batch_audit_logs enable row level security;

-- Kebijakan RLS: Pengguna terautentikasi dapat membaca data
create policy "Pengguna login dapat membaca keyword_batches"
  on keyword_batches for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca batch_schedule_settings"
  on batch_schedule_settings for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca batch_audit_logs"
  on batch_audit_logs for select
  to authenticated
  using (true);

-- Inisialisasi pengaturan awal penjadwalan
insert into batch_schedule_settings (id, mode)
values (1, 'auto')
on conflict (id) do nothing;

-- Inisialisasi 3 batch awal (Batch 1 aktif)
insert into keyword_batches (name, description, order_index, is_active, is_enabled)
values
  ('Batch 1', 'Batch rotasi mingguan 1', 1, true, true),
  ('Batch 2', 'Batch rotasi mingguan 2', 2, false, true),
  ('Batch 3', 'Batch rotasi mingguan 3', 3, false, true)
on conflict (order_index) do nothing;

-- Hubungkan seluruh keyword yang belum memiliki batch ke Batch 1 (batch aktif awal)
update keywords
set batch_id = (
  select id from keyword_batches where order_index = 1 limit 1
)
where batch_id is null;

-- Catat entri awal audit trail
insert into batch_audit_logs (previous_batch_id, new_batch_id, trigger_type, actor_id, notes)
values (
  null,
  (select id from keyword_batches where order_index = 1 limit 1),
  'initial_setup',
  'system',
  'Inisialisasi batch awal (Batch 1 aktif)'
);
