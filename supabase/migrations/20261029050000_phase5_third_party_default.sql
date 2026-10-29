-- Migrasi Fase 5 (Bagian B): Pastikan nilai awal saklar "Cek sumber pihak ketiga" adalah mati (false)

insert into settings (key, value)
values (
  'search_config',
  '{"location": "Indonesia", "google_domain": "google.co.id", "gl": "id", "hl": "id", "enable_third_party_check": false}'::jsonb
)
on conflict (key) do update
set value = jsonb_set(settings.value, '{enable_third_party_check}', 'false'::jsonb, true),
    updated_at = now();
