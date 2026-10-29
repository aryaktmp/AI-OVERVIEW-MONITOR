-- =============================================================================
-- SARAN PERBAIKAN SQL (supabase/verify/fix-suggestions.sql)
-- Dihasilkan otomatis oleh npm run verify:db
-- PENTING: Tinjau setiap pernyataan di bawah ini sebelum menjalankannya di Supabase SQL Editor.
-- =============================================================================

-- Ditemukan 2 temuan (FAIL / DRIFT) yang memerlukan perhatian:

-- [FAIL] search_path Fungsi SECURITY DEFINER public.claim_next_run_item (Sumber migrasi: 20261029010000_phase3_queue_and_calls.sql)
--   Diharapkan : SET search_path = public
--   Ditemukan  : search_path tidak diatur (null)
--   Tindakan   : Tetapkan search_path = public pada fungsi SECURITY DEFINER public.claim_next_run_item
ALTER FUNCTION public.claim_next_run_item(timestamp with time zone) SET search_path = public;

-- [FAIL] Seed settings: "search_config" (enable_third_party_check) (Sumber migrasi: 20261029060000_predeploy_hardening.sql)
--   Diharapkan : enable_third_party_check = false
--   Ditemukan  : enable_third_party_check = true
--   Tindakan   : Ubah enable_third_party_check menjadi false pada public.settings
UPDATE public.settings SET value = jsonb_set(value, '{enable_third_party_check}', 'false'::jsonb, true), updated_at = now() WHERE key = 'search_config';

-- =============================================================================
-- SARAN OPSIONAL LAPISAN PERTAHANAN TAMBAHAN (Defense-in-Depth)
-- Secara bawaan Supabase memberikan GRANT pada tabel di schema public kepada
-- role anon dan authenticated, lalu mengandalkan RLS untuk memblokir akses.
-- Sebagai lapisan pengamanan tambahan, Anda dapat mencabut hak dari anon
-- serta mencabut hak tulis (INSERT, UPDATE, DELETE, TRUNCATE) dari authenticated:
-- =============================================================================

-- Cabut seluruh hak tabel dari role anon (karena aplikasi mewajibkan login):
-- REVOKE ALL ON TABLE keyword_groups, keywords, brand_terms, competitors, check_runs, run_items, checks, check_sources, page_cache, settings FROM anon;

-- Cabut hak tulis tabel dari role authenticated (penulisan hanya via service_role di server):
-- REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE keyword_groups, keywords, brand_terms, competitors, check_runs, run_items, checks, check_sources, page_cache, settings FROM authenticated;
