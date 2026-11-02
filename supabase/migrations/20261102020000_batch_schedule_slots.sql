-- Migrasi 20261102020000_batch_schedule_slots.sql:
-- Fase Data: Sistem Slot Penjadwalan Bulanan (4 Slot Minggu)
-- 1. Tabel batch_schedule_slots untuk memetakan 4 minggu rotasi (Week 1 s/d Week 4) ke batch tertentu.
-- 2. Kolom color pada keyword_batches untuk identifikasi visual batch di kartu slot/kalender.
-- 3. Kolom max_runs_per_month pada batch_schedule_settings.
-- 4. Indeks dan Row Level Security (RLS) untuk akses pengguna terautentikasi.
-- 5. Inisialisasi awal 4 slot jadwal bulanan (Slot 1..3 -> Batch 1..3, Slot 4 -> Batch 1 looping).

create table if not exists batch_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  week_number int not null unique check (week_number between 1 and 4),
  batch_id uuid references keyword_batches(id) on delete set null,
  is_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indeks untuk pencarian cepat per minggu dan relasi batch
create index if not exists batch_schedule_slots_week_number_idx
  on batch_schedule_slots (week_number);

create index if not exists batch_schedule_slots_batch_id_idx
  on batch_schedule_slots (batch_id);

-- Aktifkan Row Level Security (RLS)
alter table batch_schedule_slots enable row level security;

-- Kebijakan RLS: Pengguna login dapat membaca batch_schedule_slots
create policy "Pengguna login dapat membaca batch_schedule_slots"
  on batch_schedule_slots for select
  to authenticated
  using (true);

-- Tambah kolom color di keyword_batches untuk visualisasi slot dan kartu
alter table keyword_batches
  add column if not exists color text default '#6366f1';

-- Berikan warna default yang jelas untuk batch awal
update keyword_batches set color = '#3b82f6' where order_index = 1 and (color is null or color = '#6366f1');
update keyword_batches set color = '#10b981' where order_index = 2 and (color is null or color = '#6366f1');
update keyword_batches set color = '#f59e0b' where order_index = 3 and (color is null or color = '#6366f1');

-- Tambah konfigurasi max_runs_per_month di batch_schedule_settings
alter table batch_schedule_settings
  add column if not exists max_runs_per_month int not null default 4;

-- Inisialisasi 4 slot mingguan bulanan (Week 1 - 4)
-- Logika rotasi: Jika batch < 4, ulangi dari batch pertama (Batch 1 pada Week 4)
insert into batch_schedule_slots (week_number, batch_id, is_override)
values
  (1, (select id from keyword_batches where order_index = 1 limit 1), false),
  (2, (select id from keyword_batches where order_index = 2 limit 1), false),
  (3, (select id from keyword_batches where order_index = 3 limit 1), false),
  (4, (select id from keyword_batches where order_index = 1 limit 1), false)
on conflict (week_number) do nothing;

-- Catat entri awal audit trail untuk pembuatan slot
insert into batch_audit_logs (previous_batch_id, new_batch_id, trigger_type, actor_id, notes)
values (
  null,
  null,
  'slots_initial_setup',
  'system',
  'Inisialisasi 4 slot rotasi bulanan (Week 1 s/d Week 4)'
);
