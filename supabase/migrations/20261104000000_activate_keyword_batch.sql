-- Migrasi 20261104000000_activate_keyword_batch.sql:
-- Fungsi public.activate_keyword_batch untuk aktivasi batch atomik dalam satu transaksi:
-- 1. Menonaktifkan batch aktif lama (is_active = false)
-- 2. Mengaktifkan batch baru (is_active = true)
-- 3. Menulis batch_audit_logs
-- 4. SECURITY DEFINER, search_path = public, pg_temp
-- 5. Hak EXECUTE dicabut dari PUBLIC, anon, authenticated, dan diberikan hanya ke service_role

create or replace function public.activate_keyword_batch(
  target_batch_id uuid,
  trigger_type text,
  actor_id text default 'system',
  notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prev_batch_id uuid;
  target_batch record;
  audit_id uuid;
begin
  -- Cari batch yang sedang aktif saat ini
  select id into prev_batch_id
  from public.keyword_batches
  where is_active = true
  limit 1;

  -- Pastikan batch target valid dan ada di database
  select * into target_batch
  from public.keyword_batches
  where id = target_batch_id;

  if not found then
    raise exception 'Batch dengan id % tidak ditemukan.', target_batch_id;
  end if;

  -- Nonaktifkan seluruh batch lain yang sedang aktif
  update public.keyword_batches
  set is_active = false, updated_at = now()
  where is_active = true and id <> target_batch_id;

  -- Aktifkan batch target
  update public.keyword_batches
  set is_active = true, updated_at = now()
  where id = target_batch_id;

  -- Catat log audit pergantian batch dalam transaksi yang sama
  insert into public.batch_audit_logs (
    previous_batch_id,
    new_batch_id,
    trigger_type,
    actor_id,
    notes,
    created_at
  )
  values (
    prev_batch_id,
    target_batch_id,
    trigger_type,
    actor_id,
    notes,
    now()
  )
  returning id into audit_id;

  return jsonb_build_object(
    'previous_batch_id', prev_batch_id,
    'new_batch_id', target_batch_id,
    'audit_log_id', audit_id
  );
end;
$$;

revoke all on function public.activate_keyword_batch(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.activate_keyword_batch(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.activate_keyword_batch(uuid, text, text, text) to service_role;
