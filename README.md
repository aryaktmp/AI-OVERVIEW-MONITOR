# Pemantau Kutipan Google AI Overview — LinovHR

Aplikasi web untuk memantau apakah **LinovHR (`linovhr.com`)** muncul di Google AI Overview untuk berbagai keyword di pasar Indonesia (`google.co.id`, `gl=id`, `hl=id`). Dirancang netral terhadap platform hosting sehingga dapat dijalankan di **Vercel Hobby** (tahap uji) maupun **VPS sendiri** (produksi).

## Fitur Utama

1. **Tiga Tingkat Deteksi**:
   - **Tingkat 1 (`detected_domain`)**: Hostname `linovhr.com` atau subdomainnya dikutip langsung sebagai referensi AI Overview.
   - **Tingkat 2 (`detected_text`)**: Istilah merek (`LinovHR`, `Linov HR`, `linovhr.com`) disebut di dalam teks jawaban AI Overview.
   - **Tingkat 3 (`detected_third_party`)**: Halaman sumber pihak ketiga yang dikutip oleh AI Overview menyebut istilah merek atau menautkan ke `linovhr.com` (dilengkapi cache 7 hari, batas waktu 15 detik per keyword, dan proteksi SSRF berlapis).
2. **Antrean Atomik & Batas Laju**: Memproses keyword secara bertahap melalui endpoint HTTP `/api/cron/*` dengan klaim atomik (`FOR UPDATE SKIP LOCKED`), batas laju `SERPAPI_MAX_PER_HOUR`, batas durasi yang dapat dikonfigurasi lewat `MAX_DURATION_MS`, serta jalur cepat (*fast-path*) saat antrean kosong.
3. **Dasbor Analitik & Impor/Ekspor CSV**: Ringkasan statistik, grafik tren 8 minggu, peta status keyword, analisis domain kompetitor, impor CSV keyword dengan pratinjau, ekspor CSV terpaginasi dengan proteksi formula injection, serta pemantauan kapasitas database terhadap batas 500 MB.

## Stack Teknologi

- **Framework**: Next.js 15 (App Router), TypeScript (Strict Mode)
- **Styling & UI**: Tailwind CSS, shadcn/ui, Recharts, TanStack Table
- **Database & Auth**: Supabase (PostgreSQL, Auth, Row Level Security)
- **Validasi & Pengujian**: Zod 4, Vitest

## Urutan Migrasi Database (`supabase/migrations/`)

Jalankan keenam file migrasi berikut secara berurutan di Supabase SQL Editor:

1. `20261029000000_init_schema.sql`
2. `20261029010000_phase3_queue_and_calls.sql`
3. `20261029020000_phase3_fixes.sql`
4. `20261029030000_phase4_settings_and_views.sql`
5. `20261029040000_phase4_fixes.sql`
6. `20261029050000_phase5_third_party_default.sql`

## Persiapan Lingkungan Lokal

1. Salin file `.env.example` menjadi `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Isi variabel lingkungan wajib di `.env.local` (lihat daftar lengkap beserta variabel opsional `MAX_DURATION_MS`, `APP_URL`, dan `SITE_URL` di `.env.example`).
3. Verifikasi konfigurasi lingkungan dan koneksi nyata:
   ```bash
   npm run check:env
   ```
4. Instal dependensi dan jalankan server pengembangan:
   ```bash
   npm install
   npm run dev
   ```

## Daftar Skrip NPM

| Perintah | Fungsi |
| :--- | :--- |
| `npm run dev` | Menjalankan server pengembangan Next.js. |
| `npm run build` | Membangun aplikasi untuk produksi. |
| `npm test` | Menjalankan seluruh pengujian unit Vitest. |
| `npm run typecheck` | Memeriksa tipe TypeScript (`tsc --noEmit`). |
| `npm run lint` | Menjalankan pemeriksaan ESLint. |
| `npm run check:env` | Memeriksa format variabel lingkungan, koneksi Supabase/SerpApi, RLS, dan keamanan kode. |
| `npm run check:env -- --production` | Memeriksa kesiapan produksi (`SERPAPI_DRY_RUN=false`, `CRON_SECRET` >= 32 karakter, bebas data `is_demo`, dan Site URL bukan `localhost`). |
| `npm run seed:demo` | Mengisi data contoh 8 minggu (`is_demo = true`) untuk melihat tampilan dasbor. |
| `npm run seed:clear` | Menghapus seluruh data contoh (`is_demo = true`) dari semua tabel. |
| `npm run try:keyword -- "<keyword>"` | Menguji panggilan SerpApi nyata dan deteksi tingkat 1 & 2 untuk satu keyword. |
| `npm run try:fetch -- "<url>"` | Menguji pengambilan halaman pihak ketiga nyata (deteksi tingkat 3 & proteksi SSRF) untuk satu URL. |

## Panduan Deploy & Migrasi VPS

Lihat dokumentasi lengkap di [DEPLOY.md](./DEPLOY.md) untuk pengaturan jadwal Vercel Hobby, GitHub Actions, perhitungan menit bulanan, urutan go-live, serta langkah pemindahan ke VPS sendiri.
