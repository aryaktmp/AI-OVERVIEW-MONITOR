-- Pemindai Konsistensi Database Supabase (Hanya Baca / Read-Only)
-- Jalankan kueri ini di Supabase SQL Editor. Kueri ini menghasilkan satu tabel (objek, status, detail).
-- Ekspor hasil sebagai CSV atau salin tabel hasil, lalu jalankan:
-- npm run verify:db -- --from-file <path-ke-file-hasil>

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
db_tables AS (
  SELECT
    c.relname AS name,
    c.oid AS rel_oid,
    c.relrowsecurity AS rls_enabled
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
db_views AS (
  SELECT
    c.relname AS name,
    COALESCE(
      EXISTS (
        SELECT 1 FROM unnest(c.reloptions) opt
        WHERE opt = 'security_invoker=true' OR opt = 'security_invoker=on' OR opt = 'security_invoker=1'
      ),
      false
    ) AS security_invoker
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
),
db_functions AS (
  SELECT
    p.proname AS name,
    p.oid AS fn_oid,
    p.prosecdef AS sec_definer,
    COALESCE(array_to_string(p.proconfig, ','), '') AS config_str,
    pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS pub_exec,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
    pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
)

SELECT * FROM (
  -- a. Tabel di Manifest
  SELECT
    'a. Tabel: ' || et.name AS objek,
    CASE WHEN dt.name IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN dt.name IS NOT NULL THEN 'Tabel tersedia di schema public' ELSE 'Tabel hilang / belum dimigrasi' END AS detail
  FROM expected_tables et
  LEFT JOIN db_tables dt ON dt.name = et.name

  UNION ALL

  -- a. Tabel DRIFT
  SELECT
    'a. Tabel ekstra: ' || dt.name AS objek,
    'DRIFT' AS status,
    'Tabel ada di schema public tetapi tidak terdaftar di manifest' AS detail
  FROM db_tables dt
  WHERE dt.name NOT IN ('keyword_groups', 'keywords', 'brand_terms', 'competitors', 'check_runs', 'run_items', 'checks', 'check_sources', 'page_cache', 'settings')

  UNION ALL

  -- b. Kolom
  SELECT
    'b. Kolom: ' || c.relname || '.' || a.attname AS objek,
    'PASS' AS status,
    'tipe=' || pg_catalog.format_type(a.atttypid, a.atttypmod) ||
    ', nullable=' || (NOT a.attnotnull)::text ||
    ', default=' || COALESCE(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), 'null') AS detail
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    AND c.relname IN ('keyword_groups', 'keywords', 'brand_terms', 'competitors', 'check_runs', 'run_items', 'checks', 'check_sources', 'page_cache', 'settings')

  UNION ALL

  -- c. Constraint
  SELECT
    'c. Constraint: ' || con.conname AS objek,
    'PASS' AS status,
    'tabel=' || c.relname || ', tipe=' || con.contype ||
    CASE WHEN con.confdeltype != ' ' THEN ', on_delete=' || con.confdeltype::text ELSE '' END AS detail
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
  WHERE n.nspname = 'public'

  UNION ALL

  -- c. Indeks
  SELECT
    'c. Indeks: ' || i.relname AS objek,
    'PASS' AS status,
    'tabel=' || t.relname || ', unique=' || ix.indisunique::text AS detail
  FROM pg_catalog.pg_index ix
  JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
  JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND NOT ix.indisprimary

  UNION ALL

  -- d. RLS
  SELECT
    'd. RLS: ' || dt.name AS objek,
    CASE WHEN dt.rls_enabled THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN dt.rls_enabled THEN 'Row Level Security aktif (pg_class.relrowsecurity = true)' ELSE 'RLS BELUM DIAKTIFKAN!' END AS detail
  FROM db_tables dt

  UNION ALL

  -- d. Kebijakan RLS
  SELECT
    'd. Kebijakan: ' || pol.polname AS objek,
    'PASS' AS status,
    'tabel=' || c.relname || ', cmd=' || pol.polcmd AS detail
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  -- e. Hak Tabel
  SELECT
    'e. Hak tabel: ' || dt.name AS objek,
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

  -- g. Fungsi di Manifest
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

  -- g. Fungsi ekstra (DRIFT vs dikelola Supabase)
  SELECT
    'g. Fungsi ekstra: ' || df.name AS objek,
    CASE
      WHEN df.name = 'rls_auto_enable' THEN 'INFO'
      ELSE 'DRIFT'
    END AS status,
    CASE
      WHEN df.name = 'rls_auto_enable' THEN 'Fungsi pembantu otomatis dikelola oleh platform Supabase (Enable automatic RLS)'
      ELSE 'Fungsi ada di schema public tetapi tidak ada di manifest'
    END AS detail
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

  -- h. Seed settings
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

  -- i. Baris is_demo
  SELECT
    'i. Baris is_demo=true' AS objek,
    'INFO' AS status,
    'check_runs=' || (SELECT count(*) FROM public.check_runs WHERE is_demo = true)::text ||
    ', keywords=' || (SELECT count(*) FROM public.keywords WHERE is_demo = true)::text ||
    ', keyword_groups=' || (SELECT count(*) FROM public.keyword_groups WHERE is_demo = true)::text ||
    ', competitors=' || (SELECT count(*) FROM public.competitors WHERE is_demo = true)::text AS detail

  UNION ALL

  -- j. Riwayat Migrasi
  SELECT
    'j. schema_migrations' AS objek,
    'INFO' AS status,
    COALESCE(
      (SELECT string_agg(version, ', ' ORDER BY version) FROM supabase_migrations.schema_migrations),
      'Tabel schema_migrations kosong / migrasi dijalankan manual di SQL Editor'
    ) AS detail

  UNION ALL

  -- l. Ekstensi
  SELECT
    'l. Ekstensi: pgcrypto' AS objek,
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto') THEN 'PASS' ELSE 'FAIL' END AS status,
    'pgcrypto ekstensi terpasang' AS detail

  UNION ALL

  -- INFO: Event Trigger ensure_rls
  SELECT
    'INFO. Event Trigger: ensure_rls' AS objek,
    'INFO' AS status,
    CASE
      WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtname = 'ensure_rls')
        THEN 'Event trigger ensure_rls aktif di database (dikelola oleh platform Supabase)'
      ELSE 'Event trigger ensure_rls tidak ditemukan di database'
    END AS detail
) sub
ORDER BY objek;
