-- Migrasi Fase 1: Skema Database & Row Level Security (RLS)
-- Pemantau Kutipan Google AI Overview untuk LinovHR

create extension if not exists "pgcrypto";

create table if not exists keyword_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table if not exists keywords (
  id uuid primary key default gen_random_uuid(),
  text text not null unique,
  group_id uuid references keyword_groups(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists brand_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null unique,
  enabled boolean not null default true
);

create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique
);

create table if not exists check_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- running, done, failed
  total int not null default 0,
  done int not null default 0
);

create table if not exists run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references check_runs(id) on delete cascade,
  keyword_id uuid not null references keywords(id) on delete cascade,
  state text not null default 'pending',   -- pending, processing, done, error
  attempts int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);

create table if not exists checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references check_runs(id) on delete cascade,
  keyword_id uuid not null references keywords(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null,                    -- no_ai_overview, not_detected, detected
  answer_text text,
  detected_domain boolean not null default false,
  detected_text boolean not null default false,
  detected_third_party boolean not null default false,
  raw jsonb
);

create table if not exists check_sources (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references checks(id) on delete cascade,
  position int not null,
  title text,
  url text not null,
  domain text not null,
  is_own boolean not null default false,
  is_competitor boolean not null default false,
  mentions_brand boolean not null default false
);

create table if not exists page_cache (
  url text primary key,
  fetched_at timestamptz not null default now(),
  mentions_brand boolean not null,
  status int
);

-- Indeks sesuai SPEC.md
create index if not exists checks_keyword_id_checked_at_idx on checks (keyword_id, checked_at desc);
create index if not exists run_items_run_id_state_idx on run_items (run_id, state);
create index if not exists check_sources_check_id_idx on check_sources (check_id);

-- Aktifkan Row Level Security (RLS) di semua tabel
alter table keyword_groups enable row level security;
alter table keywords enable row level security;
alter table brand_terms enable row level security;
alter table competitors enable row level security;
alter table check_runs enable row level security;
alter table run_items enable row level security;
alter table checks enable row level security;
alter table check_sources enable row level security;
alter table page_cache enable row level security;

-- Kebijakan RLS: Hanya pengguna login (authenticated) yang boleh membaca.
-- Penulisan data hanya lewat server dengan kunci secret (service_role melewati RLS).
create policy "Pengguna login dapat membaca keyword_groups"
  on keyword_groups for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca keywords"
  on keywords for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca brand_terms"
  on brand_terms for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca competitors"
  on competitors for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca check_runs"
  on check_runs for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca run_items"
  on run_items for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca checks"
  on checks for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca check_sources"
  on check_sources for select
  to authenticated
  using (true);

create policy "Pengguna login dapat membaca page_cache"
  on page_cache for select
  to authenticated
  using (true);

-- Data awal istilah merek sesuai SPEC.md
-- "Istilah awal: LinovHR, Linov HR, linovhr.com."
-- "Jangan pakai Linov sendirian secara bawaan. Terlalu banyak hasil palsu. Sediakan sebagai opsi yang mati."
insert into brand_terms (term, enabled)
values
  ('LinovHR', true),
  ('Linov HR', true),
  ('linovhr.com', true),
  ('Linov', false)
on conflict (term) do nothing;
