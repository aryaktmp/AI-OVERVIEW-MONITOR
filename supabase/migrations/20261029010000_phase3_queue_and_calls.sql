-- Migrasi Fase 3: Catatan Jumlah Panggilan SerpApi per Run & Fungsi Klaim Atomik
alter table check_runs
  add column if not exists serpapi_calls int not null default 0;

alter table checks
  add column if not exists serpapi_calls int not null default 1;

-- Fungsi opsional klaim item antrean secara atomik dengan FOR UPDATE SKIP LOCKED
create or replace function claim_next_run_item(max_backoff_cutoff timestamptz default now())
returns setof run_items
language sql
security definer
as $$
  update run_items
  set state = 'processing',
      updated_at = now()
  where id = (
    select id
    from run_items
    where state = 'pending'
      and (attempts = 0 or updated_at <= max_backoff_cutoff)
    order by updated_at asc
    for update skip locked
    limit 1
  )
  returning *;
$$;
