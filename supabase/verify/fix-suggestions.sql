-- =============================================================================
-- SARAN PERBAIKAN SQL (supabase/verify/fix-suggestions.sql)
-- Dihasilkan otomatis oleh npm run verify:db
-- PENTING: Tinjau pernyataan di bawah ini sebelum menjalankannya di Supabase SQL Editor.
-- =============================================================================

-- =============================================================================
-- 1. JALANKAN FILE MIGRASI YANG TERSEDIA
-- Selisih yang terdeteksi di atas dapat diselesaikan langsung dengan menjalankan
-- file migrasi berikut di Supabase SQL Editor (tanpa perlu UPDATE ad hoc):
-- =============================================================================

-- -> Jalankan file: supabase/migrations/20261029070000_function_search_path.sql

-- =============================================================================
-- 3. SARAN OPSIONAL LAPISAN PERTAHANAN TAMBAHAN (Defense-in-Depth)
-- Secara bawaan Supabase memberikan GRANT pada tabel di schema public kepada
-- role anon dan authenticated, lalu mengandalkan RLS untuk memblokir akses.
-- Sebagai lapisan pengamanan tambahan, Anda dapat mencabut hak dari anon
-- serta mencabut hak tulis (INSERT, UPDATE, DELETE, TRUNCATE) dari authenticated:
-- =============================================================================

-- Cabut seluruh hak tabel dari role anon (karena dasbor mewajibkan login):
-- REVOKE ALL ON TABLE keyword_groups, keywords, brand_terms, competitors, check_runs, run_items, checks, check_sources, page_cache, settings FROM anon;

-- Cabut hak tulis tabel dari role authenticated (penulisan hanya via service_role di server):
-- REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE keyword_groups, keywords, brand_terms, competitors, check_runs, run_items, checks, check_sources, page_cache, settings FROM authenticated;
