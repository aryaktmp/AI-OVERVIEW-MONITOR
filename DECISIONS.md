# Catatan Keputusan Teknis (DECISIONS.md)

Dokumen ini mencatat keputusan teknis yang diambil ketika spesifikasi di `SPEC.md` tidak merinci detail implementasi tertentu. Sesuai aturan, opsi paling sederhana dipilih.

## Fase 0: Inisialisasi Proyek

1. **Token Warna & Tipografi (`app/globals.css`)**:
   - Menggunakan variabel CSS persis seperti prototipe `dashboard-ai-overview.html` (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--cite`, `--cite-bg`, `--seen`, `--seen-bg`, `--none`, `--accent`) beserta dukungan mode gelap otomatis dan font `Plus Jakarta Sans`.
2. **Komponen `shadcn/ui`**:
   - Membangun komponen dasar (`Button`, `Card`, `Input`, `Badge`) menggunakan primitif Radix UI dan `class-variance-authority` yang langsung terhubung ke variabel tema prototipe agar tampilan ringan dan konsisten.
3. **Validasi Variabel Lingkungan (`lib/env.ts`)**:
   - Menggunakan skema Zod (`envSchema`) dengan evaluasi saat dibutuhkan (`getEnv()`) agar aplikasi tetap dapat dikompilasi dan diuji pada lingkungan tanpa rahasia produksi, sambil menjamin validasi ketat saat endpoint dipanggil.
   - Menggunakan format kunci API terbaru Supabase: `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) dan `SUPABASE_SECRET_KEY` (`sb_secret_...`), dengan fallback kompatibilitas ke nama variabel lama jika diperlukan.

## Fase 1: Migrasi Database, RLS, dan Login Allowlist

1. **Autentikasi Server-Side Tanpa `NEXT_PUBLIC_`**:
   - Seluruh operasi Supabase Auth (`signInWithPassword`, `signInWithOtp`, `signOut`, serta pembacaan sesi) dijalankan di sisi server melalui Server Actions (`app/(auth)/login/actions.ts`), Route Handler (`app/auth/callback/route.ts`), dan Middleware (`middleware.ts`) menggunakan `@supabase/ssr`. Dengan demikian, kunci Supabase tetap berada di variabel lingkungan server tanpa awalan `NEXT_PUBLIC_`.
2. **Dukungan Metode Masuk Ganda (Kata Sandi & Tautan Email OTP)**:
   - Halaman `/login` menyediakan pilihan masuk dengan kata sandi maupun tautan email (Magic Link / OTP) dengan `shouldCreateUser: false`, serta memeriksa `isEmailAllowed()` sebelum dan sesudah autentikasi ke Supabase.
3. **Seed Data Istilah Merek Awal**:
   - Migrasi SQL (`supabase/migrations/20261029000000_init_schema.sql`) langsung mengisi tabel `brand_terms` dengan `LinovHR` (aktif), `Linov HR` (aktif), `linovhr.com` (aktif), dan `Linov` (nonaktif secara bawaan) sesuai aturan di `SPEC.md`.

## Fase 2: Klien SerpApi, Parser, dan Deteksi Tingkat 1 & 2

1. **Ekstraksi Teks & Referensi Berdasarkan Struktur Asli SerpApi (`lib/serpapi.ts`)**:
   - Berdasarkan fixture asli di `tests/fixtures/`, objek `ai_overview` memuat `text_blocks` (dengan tipe `paragraph`, `heading`, `list` beserta item `snippet` dan `snippet_links`) serta array `references` (`index`, `title`, `link`, `snippet`, `source`). Parser mengekstrak seluruh teks dari `text_blocks` secara berurutan dan memetakan setiap `references` menjadi `{ position, title, url, domain }`.
   - Jika `ai_overview` hanya berisi `page_token` (seperti pada `tests/fixtures/ai-overview-tidak-ada.json`), parser menandai `hasAiOverview: false` dan mengekstrak `pageToken`, lalu fungsi `fetchKeywordAiOverview()` segera melakukan panggilan kedua ke `engine=google_ai_overview&page_token=...`.
2. **Pencocokan Kata Utuh Istilah Merek (`lib/detect.ts`)**:
   - Menggunakan ekspresi reguler dengan batas karakter non-alfanumerik (`(?<![a-zA-Z0-9])...(?![a-zA-Z0-9])`, serta menolak tanda hubung untuk istilah berbentuk domain seperti `linovhr.com`) agar pencocokan kata utuh tetap akurat untuk istilah yang memuat spasi (`Linov HR`) maupun titik (`linovhr.com`).

## Fase 3: Antrean, Batas Laju, Percobaan Ulang, dan Mode Dry-Run

1. **Klaim Atomik & Pemulihan Item Macet (`lib/queue.ts`)**:
   - Setiap item `pending` diklaim secara atomik menggunakan `UPDATE run_items SET state = 'processing', updated_at = now() WHERE id = $1 AND state = 'pending' RETURNING *` (serta disediakan fungsi SQL `claim_next_run_item()` dengan `FOR UPDATE SKIP LOCKED` di migrasi).
   - Sebelum mengambil item `pending`, `recoverStuckProcessingItems()` mengembalikan item yang berada di `state = 'processing'` lebih dari 10 menit kembali ke `pending`.
2. **Pencatatan Jumlah Panggilan SerpApi per Cek & per Run**:
   - Jumlah panggilan SerpApi (`1` untuk panggilan tunggal, `2` jika `page_token` ditindaklanjuti ke `engine=google_ai_overview`) disimpan di `checks.raw.serpapi_calls_count` dan dijumlahkan ke ringkasan `check_runs` (`serpApiCalls`) serta perhitungan batas laju 60 menit terakhir (`SERPAPI_MAX_PER_HOUR`).
3. **Mode `SERPAPI_DRY_RUN=true`**:
   - Secara bawaan di `.env.example` bernilai `true`. Dalam mode ini, `fetchKeywordAiOverview()` mengembalikan data dari ke-4 fixture asli secara deterministik tanpa koneksi jaringan ke SerpApi.
4. **Pengamanan RPC & Penandaan `is_demo` (Perbaikan Fase 3)**:
   - Fungsi SQL `public.claim_next_run_item(timestamptz)` dicabut hak `EXECUTE`-nya dari `PUBLIC`, `anon`, dan `authenticated`, serta hanya diberikan kepada `service_role`.
   - `startCheckRun()` dibuat idempoten: jika terdapat `check_runs` berstatus `running`, fungsi mengembalikan run tersebut tanpa membuat baris baru.
   - Perhitungan batas laju per jam (`getHourlySerpApiCalls`) mengecualikan hasil dari run dry-run (`raw.dry_run === true` / `is_demo = true`).

## Fase 4: Halaman Dasbor, Analitik, dan Seeder Data Contoh

1. **Agregasi di Server & View SQL (`security_invoker = true`)**:
   - Seluruh perhitungan kartu ringkasan, selisih mingguan, grafik tren 8 minggu, peta status keyword, dan peringkat domain kompetitor dijalankan di server (`lib/dashboard-data.ts` & `lib/analytics.ts`) serta dilengkapi view SQL `latest_keyword_checks` dan `latest_domain_citation_counts` dengan `security_invoker = true`. Browser hanya menerima hasil agregasi siap pakai tanpa menarik seluruh isi tabel `checks`.
2. **Tabel `settings` untuk Parameter Pencarian**:
   - Menyimpan konfigurasi lokasi (`location`), domain Google (`google_domain`), kode negara (`gl`), kode bahasa (`hl`), dan flag pemeriksaan sumber pihak ketiga (`enable_third_party_check`) pada tabel `settings` (`key = 'search_config'`) dengan fallback ke nilai bawaan Indonesia jika migrasi belum dijalankan.
3. **Seeder 8 Minggu (`npm run seed:demo` & `npm run seed:clear`)**:
   - Menyediakan skrip `scripts/seed-demo.ts` yang mengisi 8 minggu data contoh (`is_demo = true`) mengikuti pola deterministik dari `dashboard-ai-overview.html`, serta `scripts/seed-clear.ts` dan tombol "Hapus data contoh" di halaman Pengaturan untuk membersihkannya kapan saja.
4. **Penanda `is_demo` di Keempat Tabel, Impor CSV, & Penyimpanan Hemat (Perbaikan Fase 4)**:
   - Kolom `is_demo boolean default false` ditambahkan ke `keywords`, `keyword_groups`, dan `competitors` (selain `check_runs`). Saat `SERPAPI_DRY_RUN=false`, `startCheckRun()` otomatis mengabaikan keyword dengan `is_demo = true`.
   - `compactSerpApiRawForStorage()` menyimpan hanya blok `ai_overview` dan metadata panggilan di `checks.raw`, dilengkapi pembersihan otomatis data `raw` yang lebih tua dari 90 hari.
   - Tombol "Jalankan cek sekarang" memproses batch awal lalu melanjutkan batch berikutnya secara berkala dari halaman Pengaturan selama masih ada item `pending`.

## Fase 5: Deteksi Tingkat 3 dan Perlindungan SSRF

1. **Resolusi DNS & Penyambungan Terkunci (`lib/fetch-page.ts`)**:
   - Hanya mengizinkan skema `http:` / `https:` dan port `80` / `443`.
   - Sebelum membuka koneksi TCP, hostname diresolusikan lewat DNS dan seluruh IP hasilnya diperiksa terhadap daftar blokir (loopback `127.0.0.0/8`, privat RFC 1918, link-local & metadata cloud `169.254.0.0/16`, `0.0.0.0`, IPv6 `::1`, `fc00::/7`, `fe80::/10`, serta IPv4 yang dibungkus IPv6 seperti `::ffff:127.0.0.1` dan `64:ff9b::`).
   - Soket HTTP/HTTPS dikunci langsung ke alamat IP hasil resolusi (`lookup` terpin + `servername` TLS SNI) untuk mencegah serangan DNS rebinding. Setiap pengalihan (maksimal 3 kali) divalidasi ulang dengan aturan yang sama.
2. **Cache Dua Lapis di `page_cache`**:
   - Hasil berhasil (`status` 200–299, `text/html`) disimpan dan dipakai ulang selama 7 hari.
   - Hasil gagal (timeout 8 detik, ditolak SSRF, status HTTP >= 400, atau bukan `text/html`) disimpan dengan `mentions_brand = false` dan `status = 0` (atau kode galat HTTP) selama 24 jam agar tidak diulang terus-menerus.


