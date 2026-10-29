# Pemantau Kutipan Google AI Overview — LinovHR

Aplikasi web untuk memantau apakah **LinovHR (`linovhr.com`)** muncul di Google AI Overview untuk berbagai keyword di pasar Indonesia (`google.co.id`, `gl=id`, `hl=id`).

## Fitur Utama

1. **Tiga Tingkat Deteksi**:
   - **Tingkat 1 (`detected_domain`)**: Hostname `linovhr.com` atau subdomainnya dikutip langsung sebagai referensi AI Overview.
   - **Tingkat 2 (`detected_text`)**: Istilah merek (`LinovHR`, `Linov HR`, `linovhr.com`) disebut di dalam teks jawaban AI Overview.
   - **Tingkat 3 (`detected_third_party`)**: Halaman sumber pihak ketiga yang dikutip oleh AI Overview menyebut istilah merek atau menautkan ke `linovhr.com` (dilengkapi cache 7 hari dan proteksi SSRF).
2. **Antrean & Batas Laju**: Memproses keyword secara bertahap melalui cron dengan mematuhi batas `SERPAPI_MAX_PER_HOUR` dan mekanisme percobaan ulang otomatis.
3. **Dasbor Analitik**: Ringkasan statistik, grafik tren 8 minggu, peta status keyword, analisis domain kompetitor, impor/ekspor CSV, serta halaman pengaturan.

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
   - `SUPABASE_URL`: URL proyek Supabase
   - `SUPABASE_PUBLISHABLE_KEY`: Kunci publishable publik Supabase (`sb_publishable_...`)
   - `SUPABASE_SECRET_KEY`: Kunci secret server Supabase (`sb_secret_...`, hanya diakses di server)
   - `CRON_SECRET`: Rahasia Bearer token untuk mengamankan endpoint cron
   - `BRAND_DOMAIN`: `linovhr.com`
   - `SERPAPI_MAX_PER_HOUR`: `50` (paket gratis) atau `200` (paket Starter)
   - `ALLOWED_EMAILS`: Daftar email yang diizinkan masuk, dipisahkan koma (misal `admin@linovhr.com,tim@linovhr.com`)

3. Instal dependensi dan jalankan server pengembangan:
   ```bash
   npm install
   npm run dev
   ```

4. Jalankan pengujian dan pemeriksa kode:
   ```bash
   npm test
   npm run lint
   npm run typecheck
   ```
