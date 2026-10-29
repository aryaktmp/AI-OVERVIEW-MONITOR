# Panduan Deploy ke Produksi — Pemantau Kutipan AI Overview LinovHR

Dokumen ini menjelaskan langkah-langkah lengkap untuk men-deploy aplikasi **Pemantau Kutipan Google AI Overview LinovHR** ke **Vercel**, mengatur **Supabase Auth**, menyiapkan penjadwalan (**Vercel Cron** & **GitHub Actions**), serta urutan **go-live** yang aman.

---

## 1. Langkah Impor Repositori ke Vercel

1. Pastikan seluruh perubahan terbaru sudah di-commit dan di-push ke repositori GitHub Anda.
2. Masuk ke dasbor [Vercel](https://vercel.com/dashboard) dan klik **Add New...** -> **Project**.
3. Pilih repositori GitHub proyek ini lalu klik **Import**.
4. Pada bagian **Framework Preset**, pastikan terpilih **Next.js**.
5. Biarkan **Root Directory** dan **Build Command** (`next build`) sesuai bawaan.
6. Sebelum menekan tombol **Deploy**, buka bagian **Environment Variables** dan tambahkan seluruh variabel pada bagian 2 di bawah ini.

---

## 2. Daftar Variabel Lingkungan di Vercel (Nama Saja)

Tambahkan semua variabel berikut di **Vercel Project Settings -> Environment Variables** untuk lingkungan **Production** (dan **Preview** bila diperlukan). **Jangan pernah** menambahkan awalan `NEXT_PUBLIC_` pada variabel rahasia:

| Nama Variabel | Keterangan Singkat |
| :--- | :--- |
| `SERPAPI_KEY` | Kunci API rahasia dari SerpApi (hanya diakses di server). |
| `SUPABASE_URL` | URL proyek Supabase (`https://<project-ref>.supabase.co`). |
| `SUPABASE_PUBLISHABLE_KEY` | Kunci publishable Supabase (`sb_publishable_...`). |
| `SUPABASE_SECRET_KEY` | Kunci secret/service_role Supabase (`sb_secret_...`, hanya di server). |
| `CRON_SECRET` | String acak minimal 32 karakter (misal hasil `openssl rand -hex 32`). Vercel Cron otomatis mengirimkan nilai ini sebagai `Authorization: Bearer <CRON_SECRET>`. |
| `BRAND_DOMAIN` | Hostname domain merek utama tanpa protokol/garis miring (`linovhr.com`). |
| `SERPAPI_MAX_PER_HOUR` | Batas panggilan SerpApi per jam (misal `50` untuk paket Free atau `200` untuk paket Starter). |
| `SERPAPI_DRY_RUN` | **Wajib diisi `false` di produksi.** Jika masih `true`, aplikasi hanya membaca data fixture simulasi dan `npm run check:env` akan memberi peringatan (`WARN`) atau kegagalan (`FAIL` pada mode `--production`). |
| `ALLOWED_EMAILS` | Daftar email pengguna yang diizinkan masuk ke dasbor, dipisahkan koma tanpa spasi. |

---

## 3. Mengatur Site URL dan Redirect URLs di Supabase

Agar proses autentikasi (termasuk Magic Link / pengalihan sesi) berjalan ke domain produksi dan tidak kembali ke `localhost`:

1. Buka [Supabase Dashboard](https://supabase.com/dashboard) dan pilih proyek Anda.
2. Buka menu **Authentication** -> **URL Configuration**.
3. Pada kolom **Site URL**, ganti `http://localhost:3000` menjadi URL produksi Vercel Anda, misalnya:
   ```text
   https://ai-overview.linovhr.com
   ```
   *(atau `https://<nama-proyek-anda>.vercel.app`)*
4. Pada bagian **Redirect URLs**, tambahkan URL callback autentikasi produksi Anda:
   ```text
   https://ai-overview.linovhr.com/auth/callback
   https://<nama-proyek-anda>.vercel.app/auth/callback
   ```
5. Klik **Save** untuk menyimpan konfigurasi URL.

---

## 4. Mengatur Penjadwalan (Vercel Cron & GitHub Actions Secrets)

Aplikasi ini menggunakan dua mekanisme terjadwal:

### A. Vercel Cron (`vercel.json`)
Terdaftar otomatis saat proyek di-deploy ke Vercel:
- `GET /api/cron/start-run` — berjalan setiap **Senin pukul 01:00 UTC (08:00 WIB)** (`0 1 * * 1`) untuk membuat antrean `check_runs` mingguan.
- `GET /api/cron/cleanup-raw` — berjalan setiap **Minggu pukul 18:00 UTC (Senin 01:00 WIB)** (`0 18 * * 0`) untuk mengosongkan kolom `checks.raw` yang lebih tua dari 90 hari agar ukuran database tetap hemat di bawah batas 500 MB.

Vercel secara otomatis menyertakan header `Authorization: Bearer <CRON_SECRET>` ketika variabel lingkungan `CRON_SECRET` diatur di Vercel.

### B. GitHub Actions (`.github/workflows/process-queue.yml`)
Karena paket Vercel Hobby hanya mengizinkan cron dijalankan sekali sehari, pemrosesan antrean bertahap setiap 5 menit (`POST /api/cron/process`) dijalankan melalui GitHub Actions:

1. Buka repositori GitHub Anda -> **Settings** -> **Secrets and variables** -> **Actions**.
2. Pada tab **Secrets**, klik **New repository secret** dan tambahkan dua secret berikut:
   - `APP_URL`: URL dasar aplikasi produksi Anda tanpa garis miring di akhir (contoh: `https://ai-overview.linovhr.com`).
   - `CRON_SECRET`: Nilai yang **persis sama** dengan `CRON_SECRET` yang Anda pasang di Vercel.
3. *(Opsional)* Jika di kemudian hari Anda menggunakan paket **Vercel Pro**, Anda dapat menambahkan jadwal `*/5 * * * *` untuk `/api/cron/process` langsung di `vercel.json` dan menonaktifkan workflow GitHub Actions dengan membuat Repository Variable `ENABLE_QUEUE_WORKFLOW` bernilai `false`.

---

## 5. Urutan Go-Live ke Produksi

Ikuti urutan langkah berikut sebelum dan sesudah menayangkan aplikasi ke produksi:

1. **Terapkan seluruh migrasi database Supabase**
   Pastikan seluruh file migrasi di `supabase/migrations/` (`0001_initial_schema.sql` sampai `0004_demo_flags_and_storage.sql`) sudah dijalankan di Supabase SQL Editor.
2. **Bersihkan data contoh (`is_demo`) dari database**
   Jika sebelumnya Anda menjalankan `npm run seed:demo` atau mode dry-run, hapus seluruh data contoh terlebih dahulu:
   ```bash
   npm run seed:clear
   ```
   *(Atau klik tombol **"Hapus data contoh"** di halaman **Pengaturan** dasbor).*
3. **Pastikan `SERPAPI_DRY_RUN=false` di lingkungan produksi**
   Periksa kembali variabel lingkungan di Vercel bahwa `SERPAPI_DRY_RUN` sudah diatur ke `false`.
4. **Jalankan verifikasi kesiapan produksi**
   Sebelum go-live, jalankan skrip pemeriksa dalam mode produksi:
   ```bash
   npm run check:env -- --production
   ```
   Pastikan seluruh pemeriksaan berstatus **PASS** (termasuk `SERPAPI_DRY_RUN=false`, `CRON_SECRET` >= 32 karakter, database bebas data `is_demo`, dan Site URL bukan `localhost`).
5. **Deploy di Vercel & uji masuk dasbor**
   Buka URL produksi, masuk menggunakan akun email yang terdaftar di `ALLOWED_EMAILS`, lalu tambahkan atau impor CSV daftar keyword produksi yang ingin dipantau.
6. **Uji pemanggilan antrean pertama**
   Klik tombol **"Jalankan cek sekarang"** di halaman **Pengaturan** (atau jalankan workflow **Proses Antrean AI Overview** secara manual lewat tombol **Run workflow** di tab GitHub Actions) dan pastikan hasil pengecekan nyata terekam di halaman **Ringkasan** serta **Keyword**.
