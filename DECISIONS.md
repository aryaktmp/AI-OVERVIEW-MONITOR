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
