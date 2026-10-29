-- Migrasi Fase 4 (Bagian B): Tabel settings & View Agregasi dengan security_invoker

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;

create policy "Pengguna login dapat membaca settings"
  on settings for select
  to authenticated
  using (true);

insert into settings (key, value)
values (
  'search_config',
  '{"location": "Indonesia", "google_domain": "google.co.id", "gl": "id", "hl": "id", "enable_third_party_check": true}'::jsonb
)
on conflict (key) do nothing;

-- View cek terbaru per keyword dengan security_invoker = true
create or replace view latest_keyword_checks
with (security_invoker = true)
as
select distinct on (c.keyword_id)
  c.id as check_id,
  c.keyword_id,
  c.run_id,
  c.checked_at,
  c.status,
  c.answer_text,
  c.detected_domain,
  c.detected_text,
  c.detected_third_party,
  coalesce((c.raw->>'dry_run')::boolean, false) as is_demo
from checks c
order by c.keyword_id, c.checked_at desc;

-- View peringkat domain sumber pada cek terbaru tiap keyword dengan security_invoker = true
create or replace view latest_domain_citation_counts
with (security_invoker = true)
as
select
  cs.domain,
  bool_or(cs.is_own) as is_own,
  bool_or(cs.is_competitor) as is_competitor,
  count(distinct lkc.keyword_id)::int as keyword_count
from latest_keyword_checks lkc
join check_sources cs on cs.check_id = lkc.check_id
group by cs.domain
order by keyword_count desc, cs.domain asc;
