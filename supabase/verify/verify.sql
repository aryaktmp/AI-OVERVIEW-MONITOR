-- Pemindai Konsistensi Database Supabase (Hanya Baca / Read-Only)
-- Jalankan kueri ini di Supabase SQL Editor. Kueri ini menghasilkan satu tabel (objek, status, detail).

WITH
expected_tables(name) AS (
  VALUES ('keyword_groups'), ('keywords'), ('brand_terms'), ('competitors'), ('check_runs'), ('run_items'), ('checks'), ('check_sources'), ('page_cache'), ('settings')
),
expected_views(name) AS (
  VALUES ('latest_keyword_checks'), ('latest_domain_citation_counts')
),
expected_functions(name) AS (
  VALUES ('claim_next_run_item'), ('get_database_size_bytes'), ('cleanup_old_checks_raw')
),
expected_indexes(name) AS (
  VALUES ('checks_keyword_id_checked_at_idx'), ('run_items_run_id_state_idx'), ('check_sources_check_id_idx')
),
db_tables AS (
  SELECT c.relname AS name, c.relrowsecurity AS rls_enabled, c.oid AS rel_oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
db_views AS (
  SELECT
    c.relname AS name,
    COALESCE('security_invoker=true' = ANY(c.reloptions), false) AS security_invoker,
    pg_catalog.pg_get_viewdef(c.oid, true) AS view_def
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
),
db_functions AS (
  SELECT
    p.proname AS name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS args_sig,
    p.prosecdef AS sec_definer,
    COALESCE(array_to_string(p.proconfig, ', '), '') AS config_str,
    pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS pub_exec,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
    pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
db_policies AS (
  SELECT
    pol.polname AS policy_name,
    c.relname AS table_name,
    pol.polcmd AS cmd_code,
    ARRAY(
      SELECT CASE WHEN r_oid = 0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(r_oid) END
      FROM unnest(pol.polroles) AS r_oid
    ) AS roles
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
),
checks_union AS (
  -- a. Pemeriksaan Tabel di Manifest
  SELECT
    'a. Tabel: ' || et.name AS objek,
    CASE WHEN dt.name IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN dt.name IS NOT NULL THEN 'Tabel tersedia di schema public' ELSE 'Tabel tidak ditemukan di schema public' END AS detail
  FROM expected_tables et
  LEFT JOIN db_tables dt ON dt.name = et.name

  UNION ALL

  -- a. Tabel DRIFT (ada di public tapi tidak ada di manifest)
  SELECT
    'a. Tabel ekstra: ' || dt.name AS objek,
    'DRIFT' AS status,
    'Tabel ada di schema public tetapi tidak terdaftar di manifest migrasi' AS detail
  FROM db_tables dt
  WHERE dt.name NOT IN ('keyword_groups', 'keywords', 'brand_terms', 'competitors', 'check_runs', 'run_items', 'checks', 'check_sources', 'page_cache', 'settings')

  UNION ALL

  -- c. Indeks di Manifest
  SELECT
    'c. Indeks: ' || ei.name AS objek,
    CASE WHEN ic.relname IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN ic.relname IS NOT NULL THEN 'Indeks tersedia' ELSE 'Indeks belum dibuat' END AS detail
  FROM expected_indexes ei
  LEFT JOIN pg_catalog.pg_class ic ON ic.relname = ei.name AND ic.relkind = 'i'

  UNION ALL

  -- d & e. Status RLS per Tabel
  SELECT
    'd/e. RLS Tabel: ' || dt.name AS objek,
    CASE WHEN dt.rls_enabled THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN dt.rls_enabled THEN 'Row Level Security (RLS) aktif' ELSE 'RLS TIDAK AKTIF pada tabel public!' END AS detail
  FROM db_tables dt

  UNION ALL

  -- e. Kebijakan untuk anon atau non-SELECT untuk authenticated
  SELECT
    'e. Kebijakan: ' || dp.table_name || ' -> ' || dp.policy_name AS objek,
    CASE
      WHEN 'anon' = ANY(dp.roles) OR 'public' = ANY(dp.roles) THEN 'FAIL'
      WHEN 'authenticated' = ANY(dp.roles) AND dp.cmd_code <> 'r' THEN 'FAIL'
      ELSE 'PASS'
    END AS status,
    'Roles=' || array_to_string(dp.roles, ',') || ' | cmd_code=' || dp.cmd_code AS detail
  FROM db_policies dp

  UNION ALL

  -- e. Hak Tabel (INFO saja)
  SELECT
    'e. Hak Tabel (INFO): ' || dt.name AS objek,
    'INFO' AS status,
    'anon_select=' || pg_catalog.has_table_privilege('anon', dt.rel_oid, 'SELECT')::text ||
    ', authenticated_select=' || pg_catalog.has_table_privilege('authenticated', dt.rel_oid, 'SELECT')::text ||
    ' (Dijaga oleh RLS)' AS detail
  FROM db_tables dt

  UNION ALL

  -- f. View & security_invoker
  SELECT
    'f. View: ' || ev.name AS objek,
    CASE
      WHEN dv.name IS NULL THEN 'FAIL'
      WHEN NOT dv.security_invoker THEN 'FAIL'
      ELSE 'PASS'
    END AS status,
    CASE
      WHEN dv.name IS NULL THEN 'View tidak ditemukan'
      WHEN NOT dv.security_invoker THEN 'security_invoker belum diatur ke true'
      ELSE 'View tersedia dengan security_invoker = true'
    END AS detail
  FROM expected_views ev
  LEFT JOIN db_views dv ON dv.name = ev.name

  UNION ALL

  -- f. View DRIFT
  SELECT
    'f. View ekstra: ' || dv.name AS objek,
    'DRIFT' AS status,
    'View ada di schema public tetapi tidak ada di manifest' AS detail
  FROM db_views dv
  WHERE dv.name NOT IN ('latest_keyword_checks', 'latest_domain_citation_counts')

  UNION ALL

  -- g. Fungsi di Manifest (keberadaan, hak EXECUTE, dan search_path)
  SELECT
    'g. Fungsi: ' || ef.name AS objek,
    CASE
      WHEN df.name IS NULL THEN 'FAIL'
      WHEN df.pub_exec OR df.anon_exec OR df.auth_exec THEN 'FAIL'
      WHEN NOT df.svc_exec THEN 'FAIL'
      WHEN df.sec_definer AND position('search_path=' in df.config_str) = 0 THEN 'FAIL'
      ELSE 'PASS'
    END AS status,
    CASE
      WHEN df.name IS NULL THEN 'Fungsi tidak ditemukan di schema public'
      ELSE 'pub_exec=' || df.pub_exec::text || ', anon_exec=' || df.anon_exec::text ||
           ', auth_exec=' || df.auth_exec::text || ', service_role_exec=' || df.svc_exec::text ||
           ', config=[' || df.config_str || ']'
    END AS detail
  FROM expected_functions ef
  LEFT JOIN db_functions df ON df.name = ef.name

  UNION ALL

  -- g. Fungsi DRIFT
  SELECT
    'g. Fungsi ekstra: ' || df.name AS objek,
    'DRIFT' AS status,
    'Fungsi ada di schema public tetapi tidak ada di manifest' AS detail
  FROM db_functions df
  WHERE df.name NOT IN ('claim_next_run_item', 'get_database_size_bytes', 'cleanup_old_checks_raw')

  UNION ALL

  -- h. Seed brand_terms
  SELECT
    'h. Seed brand_terms' AS objek,
    CASE
      WHEN (
        SELECT count(*)
        FROM public.brand_terms
        WHERE (term = 'LinovHR' AND enabled = true)
           OR (term = 'Linov HR' AND enabled = true)
           OR (term = 'linovhr.com' AND enabled = true)
           OR (term = 'Linov' AND enabled = false)
      ) = 4 THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    (
      SELECT COALESCE(string_agg(term || '=' || enabled::text, ', ' ORDER BY term), 'kosong')
      FROM public.brand_terms
    ) AS detail

  UNION ALL

  -- h. Seed settings (enable_third_party_check = false)
  SELECT
    'h. Seed settings(search_config)' AS objek,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.settings
        WHERE key = 'search_config'
          AND COALESCE((value->>'enable_third_party_check')::boolean, true) = false
      ) THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    COALESCE(
      (SELECT value::text FROM public.settings WHERE key = 'search_config' LIMIT 1),
      'Baris search_config tidak ditemukan'
    ) AS detail

  UNION ALL

  -- i. Jumlah baris is_demo = true (INFO)
  SELECT
    'i. Baris is_demo=true' AS objek,
    'INFO' AS status,
    'check_runs=' || (SELECT count(*) FROM public.check_runs WHERE is_demo = true)::text ||
    ', keywords=' || (SELECT count(*) FROM public.keywords WHERE is_demo = true)::text ||
    ', keyword_groups=' || (SELECT count(*) FROM public.keyword_groups WHERE is_demo = true)::text ||
    ', competitors=' || (SELECT count(*) FROM public.competitors WHERE is_demo = true)::text AS detail

  UNION ALL

  -- l. Ekstensi pgcrypto
  SELECT
    'l. Ekstensi: pgcrypto' AS objek,
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto') THEN 'PASS' ELSE 'FAIL' END AS status,
    'Terpasang: ' || COALESCE((SELECT string_agg(extname, ', ' ORDER BY extname) FROM pg_catalog.pg_extension), 'tidak ada') AS detail
)
SELECT objek, status, detail
FROM checks_union;
