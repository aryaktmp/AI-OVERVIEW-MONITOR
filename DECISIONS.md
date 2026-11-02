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
3. **Batas Waktu Total 15 Detik per Keyword & Dekompresi Terbatas (Pengerasan Fase 5)**:
   - Pemeriksaan sumber pihak ketiga dibatasi maksimal 15 detik per keyword (`KEYWORD_THIRD_PARTY_TIMEOUT_MS = 15_000`). Sumber yang belum selesai saat batas waktu habis dilewati (`mentions_brand = false`) tanpa memblokir keyword berikutnya, dan statistik durasinya dicatat di `checks.raw.third_party_check`.
   - Batas ukuran 500 KB (`MAX_HTML_BYTES`) diterapkan pada aliran data setelah dekompresi (`gzip`, `deflate`, `br`) untuk mencegah payload terkompresi berukuran besar melampaui memori.

## Fase 6: Ekspor CSV, Penjadwalan Vercel Hobby, dan Kesiapan Pindah ke VPS

1. **Arsitektur Netral Platform (Tanpa Layanan Khusus Vercel)**:
   - Aplikasi tidak memakai paket atau layanan khusus Vercel (`@vercel/*`, Vercel KV, Edge Config, Blob, maupun header `x-vercel-*`). Seluruh state antrean, cache halaman, dan pengaturan disimpan di PostgreSQL (Supabase).
   - Semua penjadwalan hanya memanggil endpoint HTTP standar (`/api/cron/start-run`, `/api/cron/process`, `/api/cron/cleanup-raw`) dengan header `Authorization: Bearer <CRON_SECRET>`.
2. **Batas Waktu Pemrosesan dari `MAX_DURATION_MS` (`lib/queue.ts`)**:
   - Durasi kerja per pemanggilan `/api/cron/process` dibaca dari variabel lingkungan `MAX_DURATION_MS` (nilai awal `50000` ms) lewat `getConfiguredMaxDurationMs()`, bukan konstanta tetap yang terikat pada batas 60 detik Vercel. Saat dipindahkan ke VPS sendiri, batas ini dapat disesuaikan langsung dari `.env`.
3. **Jalur Cepat (Fast-Path) & Respons Terstruktur pada `/api/cron/process`**:
   - Endpoint `/api/cron/process` selalu menyertakan `pending`, `stoppedReason`, dan `runStatus` di dalam respons JSON.
   - Jika tidak ada item `pending` yang memenuhi syarat, `processQueue` langsung mengembalikan HTTP `200` (`pending: 0, stoppedReason: "queue_empty"`) tanpa menjalankan query konteks deteksi yang tidak perlu.
4. **Kombinasi Vercel Cron Harian + Loop GitHub Actions untuk Tahap Uji (Vercel Hobby)**:
   - Karena Vercel Hobby hanya mengizinkan cron maksimal sekali sehari, `vercel.json` hanya mendaftarkan 2 cron: `/api/cron/start-run` (`0 1 * * 1`, Senin 01:00 UTC / 08:00 WIB, yang sekaligus membersihkan `checks.raw` > 90 hari) dan `/api/cron/process` (`0 2 * * *`, harian 02:00 UTC).
   - Pengurasan antrean mingguan dijalankan oleh `.github/workflows/process-queue.yml` setiap jam pada hari Senin dan Selasa (`0 * * * 1,2`), yang memanggil `/api/cron/process` berulang kali dengan jeda 20 detik hingga `pending = 0`, `stoppedReason = "rate_limit"`, atau 10 menit habis. Saat pindah ke VPS, workflow ini langsung digantikan oleh `crontab` sistem di VPS.





## Standar UI: Komponen shadcn/ui untuk Konsistensi Visual dan Tampilan Terpoles

1. **Integrasi Primitif Radix UI & Desain Tema**:
   - Menambahkan komponen lengkap shadcn/ui berbasis Radix UI dan Tailwind CSS di folder `components/ui/`: `Dialog`, `Tabs`, `Table`, `Label`, `Select`, `Switch`, `Progress`, `Alert`, `Textarea`, dan `Separator`.
   - Mengonfigurasi token semantik standar shadcn/ui (`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--primary`, `--secondary`, `--muted-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`) di `app/globals.css` yang secara harmonis terhubung ke palet merek LinovHR (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--cite`, `--seen`, `--none`).
2. **Penggantian Komponen Ad-Hoc di Seluruh Halaman**:
   - **Dialog/Modal**: Mengganti kotak konfirmasi inline pada eksekusi run manual dan penghapusan data contoh di `/pengaturan` dengan shadcn `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter`.
   - **Ekspor CSV**: Mengganti dropdown popup dengan modal shadcn `Dialog` yang dilengkapi pemilih rentang tanggal, label, dan tombol aksi terstandarisasi.
   - **Tabel Data**: Mengganti elemen HTML `<table>` mentah di `/keyword`, `/keyword/[id]`, dan `/pengaturan` dengan shadcn `Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell`.
   - **Tab & Formulir Masuk**: Mengganti toggle tombol ad-hoc di `/login` dengan shadcn `Tabs`, `TabsList`, `TabsTrigger`, serta menggunakan `Label` dan `Alert` berikon.
   - **Switch & Progress**: Mengganti checkbox sumber pihak ketiga dengan shadcn `Switch` dan `Label`, serta mengganti bar progres pemrosesan dan kuota penyimpanan basis data dengan shadcn `Progress`.
   - **Statistik & Kartu**: Membungkus ringkasan metrik dan kontainer daftar kompetitor menggunakan shadcn `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`.


## 8. Standarisasi Teks Antarmuka Berbahasa Inggris (Keputusan Pemilik Proyek - 30 Oktober 2026)

Berdasarkan keputusan langsung dari pemilik proyek pada tanggal 30 Oktober 2026, seluruh antarmuka pengguna (UI) distandardisasi menggunakan bahasa Inggris secara konsisten. Keputusan ini mencakup penataan dokumen HTML dengan `<html lang="en">`, penyesuaian teks tombol, label, status, pesan peringatan dan validasi, serta konvensi waktu lokal `Asia/Jakarta` (WIB).

- **Cakupan Standarisasi Pemilik Proyek**:
  - Seluruh tampilan pengguna: Overview (`/ringkasan`), Keywords (`/keyword`), Keyword Detail (`/keyword/[id]`), Competitors (`/kompetitor`), Settings (`/pengaturan`), dan Login (`/login`).
  - Komponen bersama: Navigation header, logout pengguna, banner data demo, dialog ekspor CSV, weekly trend chart & tooltips, alerts, modal konfirmasi, dan tabel empty states.
  - Validasi formulir & feedback: Skema Zod otentikasi & CSV import, pesan server action (`app/(dashboard)/actions.ts`, `app/(auth)/login/actions.ts`), dan payload error endpoint cron/ekspor.
  - Label analitik & data: Format tanggal singkat pada bucket grafik/heatmap (`"26 Oct"`), label jenis deteksi (`"Domain cited"`, `"Brand mentioned in text"`, `"Mentioned in other sources"`), indikator status (`"Detected"`, `"Not detected"`, `"No AI Overview"`), dan nama fallback grup (`"No Group"`).
  - Format waktu dan zona: Tampilan waktu menggunakan zona waktu `Asia/Jakarta` berlabel `WIB` pada tabel riwayat pengecekan dan detail keyword.
- **Kompatibilitas Backend & Route**:
  - Skema tabel database internal, nama kolom, rute API dan halaman (`/ringkasan`, `/keyword`, `/kompetitor`, `/pengaturan`), serta nama variabel dipertahankan agar tidak mengubah arsitektur.
  - Alias kompatibilitas seperti `formatIndonesianShortDate = formatShortDate` disediakan agar tidak memecah pemanggil fungsi yang sudah ada.
- **Verifikasi**:
  - Seluruh rangkaian tes diperbarui untuk memverifikasi teks bahasa Inggris dan lulus penuh.
  - Pengecekan tipe TypeScript (`tsc --noEmit`), linting ESLint, dan `next build` berhasil tanpa galat.

## 9. Proteksi Kondisi Balapan Konkuren pada Antrean Check Runs (2 November 2026)

Untuk mencegah kondisi balapan (*race condition*) saat dua pemanggilan `/api/cron/start-run` datang bersamaan ketika tidak ada run yang sedang berjalan:
1. **Indeks Unik Parsial Database (`supabase/migrations/20261102000000_single_running_run.sql`)**:
   - Menambahkan indeks `CREATE UNIQUE INDEX IF NOT EXISTS check_runs_single_running_idx ON public.check_runs (status) WHERE status = 'running';`
   - Migrasi terlebih dahulu menutup run duplikat lama berstatus `running` (jika ada) menjadi `failed` sebelum membuat indeks agar eksekusi migrasi di database eksisting dijamin berhasil tanpa galat keunikan.
2. **Penanganan Idempoten & Penutupan Otomatis (`lib/queue.ts`)**:
   - `createSupabaseQueueStore.createCheckRun`: menangkap galat Postgres berkode `23505` (*unique_violation*), lalu memanggil `getRunningCheckRun()` dan mengembalikan run yang ada dengan `isExisting: true`. Galat selain `23505` tetap dilempar ke atas.
   - `startCheckRun`: hanya pemenang pembuatan run yang berhak mengisi `run_items`. Pemanggil yang kalah (`isExisting: true`) langsung mengembalikan run tersebut tanpa memasukkan item duplikat.
   - Jika pengisian `run_items` gagal setelah run dibuat, run tersebut segera ditutup dengan `status = 'failed'` lewat `store.markCheckRunFailed()` agar tidak menggantung dan memblokir antrean run berikutnya.

## 10. Resolusi Domain AI Overview dari Token Buram & Penanganan Origin-Only (2 November 2026)

Berdasarkan investigasi respons langsung Google SerpApi pada kueri nyata ("software hr terbaik" dan "cara hitung pph 21 karyawan"):

1. **Resolusi Domain dari Token Buram (`/goto?url=CAES...`)**:
   - Pada Google SERP desktop terbaru, anchor link referensi AI Overview dibungkus tautan Google click-tracking `https://www.google.co.id/goto?url=CAES...` di mana parameter `url` berisi token protobuf biner terenkripsi (bukan parameter URL tujuan terbuka seperti `/url?q=`).
   - Domain tujuan asli diekstrak dari parameter query `url` pada URL ikon favicon proxy Google (`https://encrypted-tbn*.gstatic.com/faviconV2?url=<DESTINATION_ORIGIN>&client=AIM...`) yang terdapat di `ref.source_icon`. Untuk platform media (seperti YouTube atau Instagram) yang menggunakan ikon lokal SerpApi, domain dipetakan dari nama platform pada `ref.source`.
   - **Mekanisme Tidak Resmi**: Ekstraksi dari endpoint Google Favicon proxy merupakan mekanisme parsing heuristik tidak resmi yang bergantung pada markup SERP Google saat ini dan dapat berubah sewaktu-waktu.
   - **Cakupan Asal Situs (Origin-Only)**: Karena parameter `url` pada `faviconV2` hanya memuat asal situs (`https://domain`), URL yang dihasilkan hanya merujuk ke beranda/origin dan tidak memuat path artikel spesifik.
2. **Penanganan Sumber Origin-Only pada Deteksi & Tingkat 3**:
   - Sumber dengan `url_is_origin_only = true` tetap valid untuk deteksi sitasi domain (Tingkat 1) dan peringkat kompetitor, namun otomatis dikecualikan dari pemindaian konten halaman Tingkat 3 karena hanya mengarah ke beranda situs. Jumlah sumber yang dilewati dicatat di `checks.raw.third_party_skipped_origin_only`.
3. **Kunci Deduplikasi URL Ternormalisasi + Judul**:
   - Karena URL berbasis asal situs dari domain yang sama memiliki URL dasar yang identik (misalnya beberapa video YouTube dari channel berbeda), kunci deduplikasi menggunakan gabungan URL ternormalisasi dan judul referensi (`${normUrl}::${title}`).
4. **Kebijakan Nilai Source Tak Dikenal**:
   - Nilai `source` yang tidak ada di daftar pemetaan platform (`KNOWN_SOURCE_PLATFORMS`) tidak ditebak menjadi domain dan ditandai `is_unresolved: true`, sehingga dikecualikan dari deteksi domain, peringkat kompetitor, dan tingkat 3 (seperti perlakuan pada referensi internal Google).

## 11. Implementasi Fase Data: Sistem Batch Keyword & Penjadwalan Mingguan (2 November 2026)

Untuk mendukung pemantauan berkala dan rotasi keyword mingguan:
1. **Entitas `keyword_batches`**:
   - Kolom: `id` (uuid PK), `name` (text), `description` (text), `order_index` (int unique), `is_active` (boolean), `is_enabled` (boolean), `is_demo` (boolean), `created_at`, `updated_at`.
   - **Indeks Unik Parsial**: `CREATE UNIQUE INDEX keyword_batches_single_active_idx ON public.keyword_batches (is_active) WHERE is_active = true;` menjamin di level basis data bahwa maksimal hanya ada SATU batch berstatus aktif secara bersamaan.
2. **Koneksi Relasi dengan `keywords`**:
   - Menambahkan kolom `keywords.batch_id` (uuid FK) merujuk ke `keyword_batches.id` dengan aturan `ON DELETE SET NULL`.
   - Dilengkapi indeks `keywords_batch_id_idx` dan `keywords_batch_id_active_idx` untuk performa kueri antrean dan filter per batch.
3. **Pengaturan & Audit Trail (`batch_schedule_settings` & `batch_audit_logs`)**:
   - `batch_schedule_settings`: menyimpan konfigurasi mode rotasi (`auto` vs `manual_frozen`) dan penanda waktu `override_until`.
   - `batch_audit_logs`: merekam audit trail setiap perpindahan batch (`previous_batch_id`, `new_batch_id`, `trigger_type`, `actor_id`, `notes`).
4. **Row Level Security (RLS)**:
   - Ketiga tabel baru dilengkapi RLS dan kebijakan izin baca (`SELECT`) untuk role `authenticated`.
5. **Inisialisasi Data Migrasi**:
   - Menginisialisasi Batch 1 (aktif), Batch 2, dan Batch 3, serta memigrasikan seluruh keyword eksisting yang belum memiliki batch ke Batch 1 agar sistem tetap berfungsi penuh (*zero-downtime & backward-compatible*).

## 12. Implementasi Fase Logika: Rotasi Otomatis, Kontrol Manual, & Search Filtering (2 November 2026)

Menerapkan aturan bisnis dan orkestrasi pemrosesan batch keyword:
1. **Rotasi Batch Otomatis (`rotateActiveKeywordBatch`)**:
   - Berjalan secara *sequential round-robin* (`Batch 1 -> Batch 2 -> Batch 3 -> Batch 1`) berdasarkan `order_index ASC`.
   - **Penanganan Edge Case Batch Kosong (*Skip Empty Batch*)**: Sistem otomatis menyaring batch yang memiliki `activeKeywords > 0`. Jika sebuah batch kosong, rotasi melompat ke batch valid berikutnya. Jika semua batch kosong, sistem mempertahankan batch aktif saat ini dan mencatat peringatan di audit log.
   - **Penanganan Edge Case Overlap Jadwal**: Sebelum merotasi, sistem memeriksa apakah ada run berstatus `running` di `check_runs`. Jika masih berjalan, rotasi ditunda (`skipped_running_run`) guna mencegah tumpang tindih data.
   - **Mode Manual Frozen & Override Until**: Jika mode `manual_frozen` aktif, rotasi rutin dilewati (kecuali dipaksa dengan flag `force: true`). Jika terdapat `override_until` yang telah kedaluwarsa, pengaturan otomatis dinormalisasi kembali ke mode `auto`.
2. **Kontrol Manual Admin (`overrideActiveKeywordBatch` & `setBatchScheduleMode`)**:
   - Admin dapat memilih batch tujuan secara eksplisit.
   - Pergantian batch aktif dilakukan secara transaksional dengan audit trail lengkap (`trigger_type: 'admin_override'`).
   - Mendukung opsi pembekuan mode (`freezeMode: true`) atau override sementara dengan batas waktu (`overrideUntil`).
3. **Filter Antrean Search Berbasis Batch Aktif (`lib/queue.ts`)**:
   - `createSupabaseQueueStore.getActiveKeywords`: secara bawaan mengambil keyword aktif dari batch yang sedang `is_active = true`. Jika tidak ada batch aktif, sistem menyediakan fallback ke seluruh keyword aktif untuk menjaga kompatibilitas.
   - Menyediakan cache in-memory jangka pendek dengan invalidasi instan (`invalidateActiveKeywordBatchCache`) setiap kali terjadi pergantian batch untuk menjamin *zero-downtime switch*.
4. **Integrasi Endpoint Cron Mingguan**:
   - `app/api/cron/start-run/route.ts`: secara otomatis memicu rotasi batch sebelum memulai pemindaian mingguan hari Senin (`?rotate=false` untuk melewatinya).
   - Menambahkan rute terdedikasi `app/api/cron/rotate-batch/route.ts` untuk pemanggilan rotasi independen via webhook/cron.

## 13. Implementasi Fase UI: Antarmuka Penjadwalan Batch & Manajemen Keyword (2 November 2026)

Menerapkan komponen antarmuka pengguna untuk manajemen batch dan pemantauan rotasi:
1. **Kartu Penjadwal Batch pada Halaman Pengaturan (`components/batch-scheduler-card.tsx`)**:
   - Menampilkan status batch yang sedang aktif beserta jumlah keyword aktifnya.
   - Menyediakan sakelar mode penjadwalan (*Automatic Rotation* vs *Manual Frozen*).
   - Dialog override manual untuk memindahkan batch aktif sewaktu-waktu dengan opsi pembekuan mode.
   - Tombol pengujian rotasi seketika (*Rotate Next Now*) dengan umpan balik pesan alert.
   - Tabel konfigurasi batch dengan tombol penonaktifan keikutsertaan rotasi (*is_enabled*) dan modal penambahan batch baru.
   - Tabel riwayat audit trail (*Batch Rotation & Override Audit Trail*) dengan zona waktu Asia/Jakarta (WIB).
2. **Integrasi Kolom & Filter Batch pada Halaman Keyword (`app/(dashboard)/keyword/`)**:
   - Kolom tabel baru *Batch* dengan lencana (*badge*) status aktif.
   - Dropdown filter multi-pilihan berdasarkan batch (*All batches*, opsi per batch, dan *Unassigned*).
   - Opsi penetapan batch pada formulir penambahan keyword baru.
3. **Server Actions Terpadu (`app/(dashboard)/actions.ts`)**:
   - `rotateBatchNowAction`, `overrideActiveBatchAction`, `updateBatchScheduleModeAction`, `updateKeywordBatchAction`, `toggleBatchEnabledAction`, dan `createBatchAction` yang secara otomatis memicu `revalidateAllDashboardRoutes()`.

## 14. Fase Data: Sistem Slot Penjadwalan Bulanan (4 Slot Minggu) (2 November 2026)

Menerapkan skema relasi dan tabel slot penjadwalan 4 minggu bulanan (`supabase/migrations/20261102020000_batch_schedule_slots.sql`):
1. **Tabel `batch_schedule_slots`**:
   - Menyediakan 4 slot mingguan (`week_number` 1 s/d 4) dengan batasan `CHECK (week_number BETWEEN 1 AND 4)` dan `UNIQUE (week_number)`.
   - Menghubungkan setiap slot ke `keyword_batches(id)` dengan relasi `ON DELETE SET NULL`.
   - Menyediakan kolom `is_override boolean default false` untuk menandai apakah slot tersebut di-override secara manual atau mengikuti rotasi otomatis.
   - Dilengkapi indeks `batch_schedule_slots_week_number_idx` dan `batch_schedule_slots_batch_id_idx`.
2. **Pengayaan Konfigurasi & Visual**:
   - Menambahkan kolom `max_runs_per_month integer default 4` pada `batch_schedule_settings` guna membatasi eksekusi cron maksimal 4 kali per bulan kalender.
   - Menambahkan kolom `color text default '#6366f1'` pada `keyword_batches` untuk pembedaan visual pada kartu kalender/slot antarmuka.
3. **Inisialisasi Slot & Audit Trail**:
   - Mengisi 4 slot mingguan awal (Slot 1..3 mengarah ke Batch 1..3, dan Slot 4 mengarah kembali ke Batch 1 sebagai pemenuhan aturan looping jika jumlah batch $N < 4$).
   - Mencatat log inisialisasi pada `batch_audit_logs` dengan `trigger_type = 'slots_initial_setup'`.




