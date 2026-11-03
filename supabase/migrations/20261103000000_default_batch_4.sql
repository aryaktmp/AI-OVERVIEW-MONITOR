-- Migrasi 20261103000000_default_batch_4.sql:
-- Menambahkan Batch 4 sebagai default batch rotasi ke-4 dan memperbarui slot Week 4

-- 1. Tambah Batch 4 jika belum ada
insert into keyword_batches (name, description, order_index, is_active, is_enabled, color)
values
  ('Batch 4', 'Batch rotasi mingguan 4', 4, false, true, '#8b5cf6')
on conflict (order_index) do update
  set color = coalesce(keyword_batches.color, '#8b5cf6');

-- 2. Perbarui slot Week 4 pada batch_schedule_slots agar mengarah ke Batch 4
update batch_schedule_slots
set batch_id = (select id from keyword_batches where order_index = 4 limit 1)
where week_number = 4;
