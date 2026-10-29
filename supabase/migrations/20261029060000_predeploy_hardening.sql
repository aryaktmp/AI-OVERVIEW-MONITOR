-- Migrasi Pra-Deploy (20261029060000):
-- 1. Pastikan nilai awal enable_third_party_check pada tabel settings adalah false (mati secara bawaan sesuai Fase 5).
-- 2. Cabut hak EXECUTE dari PUBLIC, anon, dan authenticated pada get_database_size_bytes() serta seluruh fungsi lain di schema public; beri hak EXECUTE hanya kepada service_role.

insert into public.settings (key, value)
values (
  'search_config',
  '{"location": "Indonesia", "google_domain": "google.co.id", "gl": "id", "hl": "id", "enable_third_party_check": false}'::jsonb
)
on conflict (key) do update
set value = jsonb_set(public.settings.value, '{enable_third_party_check}', 'false'::jsonb, true),
    updated_at = now();

-- Pengamanan seluruh fungsi di schema public: cabut EXECUTE dari PUBLIC, anon, dan authenticated; beri hanya ke service_role
revoke all on function public.get_database_size_bytes() from public, anon, authenticated;
revoke execute on function public.get_database_size_bytes() from public, anon, authenticated;
grant execute on function public.get_database_size_bytes() to service_role;

revoke all on function public.claim_next_run_item(timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_next_run_item(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_next_run_item(timestamptz) to service_role;

revoke all on function public.cleanup_old_checks_raw(int) from public, anon, authenticated;
revoke execute on function public.cleanup_old_checks_raw(int) from public, anon, authenticated;
grant execute on function public.cleanup_old_checks_raw(int) to service_role;
