# Pemantau Kutipan Google AI Overview — LinovHR

Aplikasi web untuk memantau apakah **LinovHR (`linovhr.com`)** muncul di Google AI Overview untuk berbagai keyword di pasar Indonesia (`google.co.id`, `gl=id`, `hl=id`).

## Fitur Utama

1. **Tiga Tingkat Deteksi**:
   - **Tingkat 1 (`detected_domain`)**: Hostname `linovhr.com` atau subdomainnya dikutip langsung sebagai referensi AI Overview.
   - **Tingkat 2 (`detected_text`)**: Istilah merek (`LinovHR`, `Linov HR`, `linovhr.com`) disebut di dalam teks jawaban AI Overview.
   - **Tingkat 3 (`detected_third_party`)**: Halaman sumber pihak ketiga yang dikutip oleh AI Overview menyebut istilah merek atau menautkan ke `linovhr.com` (dilengkapi cache 7 hari, batas waktu 15 detik per keyword, dan proteksi SSRF berlapis).
2. **Antrean Atomik & Batas Laju**: Memproses keyword secara bertahap melalui cron dengan klaim atomik (`FOR UPDATE SKIP LOCKED`), batas laju `SERPAPI_MAX_PER_HOUR`, dan mekanisme percobaan ulang otomatis.
3. **Dasbor Analitik & Impor/Ekspor CSV**: Ringkasan statistik, grafik tren 8 minggu, peta status keyword, analisis domain kompetitor, impor CSV keyword dengan pratinjau, ekspor CSV terpaginasi dengan proteksi formula injection, serta pemantauan kapasitas database terhadap batas 500 MB.

## Stack Teknologi

- **Framework**: Next.js (App Router), TypeScript (Strict Mode)
- **Styling & UI**: Tailwind CSS, shadcn/ui, Recharts, TanStack Table
- **Database & Auth**: Supabase (PostgreSQL, Auth, Row Level Security)
- **Validasi & Pengujian**: Zod, Vitest

## Persiapan Lingkungan Lokal

1. Salin file `.env.example` menjadi `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Isi variabel lingkungan di `.env.local`:
   - `SERPAPI_KEY`: Kunci API dari SerpApi (hanya diakses di server)
   - `SUPABASE_URL`: URL proyek Supabase (`https://<project-ref>.supabase.co`)
   - `SUPABASE_PUBLISHABLE_KEY`: Kunci publishable publik Supabase (`sb_publishable_...`)
   - `SUPABASE_SECRET_KEY`: Kunci secret server Supabase (`sb_secret_...`, hanya diakses di server)
   - `CRON_SECRET`: Rahasia Bearer token minimal 32 karakter untuk mengamankan endpoint cron
   - `BRAND_DOMAIN`: `linovhr.com`
   - `SERPAPI_MAX_PER_HOUR`: `50` (paket gratis) atau `200` (paket Starter)
   - `SERPAPI_DRY_RUN`: `true` untuk pengembangan lokal (memakai fixture tanpa memotong kuota SerpApi); ubah ke `false` di produksi
   - `ALLOWED_EMAILS`: Daftar email yang diizinkan masuk, dipisahkan koma tanpa spasi

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

## Panduan Deploy ke Produksi

Lihat dokumentasi lengkap di [DEPLOY.md](./DEPLOY.md) untuk langkah impor ke Vercel, pengaturan Supabase Auth Site URL & Redirect URLs, konfigurasi GitHub Actions Secrets, dan urutan go-live.
