# Panduan Deploy & Kesiapan VPS — Pemantau Kutipan AI Overview LinovHR

Dokumen ini menjelaskan langkah-langkah men-deploy aplikasi **Pemantau Kutipan Google AI Overview LinovHR** pada tahap uji di **Vercel Hobby**, pengaturan **Supabase Auth**, konfigurasi **GitHub Actions** beserta perhitungan menit bulanan, urutan **go-live**, serta panduan pemindahan ke **VPS sendiri**.

---

## 1. Urutan Migrasi Database Supabase (`supabase/migrations/`)

Sebelum menjalankan aplikasi di produksi, jalankan kedelapan file migrasi SQL berikut secara berurutan sesuai nama file di folder `supabase/migrations/`:

1. `supabase/migrations/20261029000000_init_schema.sql` — Membuat 9 tabel inti (`keyword_groups`, `keywords`, `brand_terms`, `competitors`, `check_runs`, `run_items`, `checks`, `check_sources`, `page_cache`), indeks, kebijakan RLS, dan data awal `brand_terms`.
2. `supabase/migrations/20261029010000_phase3_queue_and_calls.sql` — Menambahkan kolom `serpapi_calls` di `check_runs` dan fungsi RPC atomik `claim_next_run_item()`.
3. `supabase/migrations/20261029020000_phase3_fixes.sql` — Mencabut hak `EXECUTE` pada `claim_next_run_item()` dari `PUBLIC`, `anon`, dan `authenticated` (hanya `service_role`), serta menambahkan kolom `is_demo` di `check_runs`.
4. `supabase/migrations/20261029030000_phase4_settings_and_views.sql` — Membuat tabel `settings` (dengan RLS) serta view agregasi `latest_keyword_checks` dan `latest_domain_citation_counts` (`security_invoker = true`).
5. `supabase/migrations/20261029040000_phase4_fixes.sql` — Menambahkan kolom `is_demo` ke `keywords`, `keyword_groups`, dan `competitors`, memperbarui view `latest_keyword_checks`, serta menambahkan fungsi `get_database_size_bytes()` dan `cleanup_old_checks_raw()` khusus `service_role`.
6. `supabase/migrations/20261029050000_phase5_third_party_default.sql` — Mengatur nilai awal `enable_third_party_check: false` (mati secara bawaan) pada tabel `settings`.
7. `supabase/migrations/20261029060000_predeploy_hardening.sql` — Memastikan `enable_third_party_check` bernilai `false` di database serta mencabut eksplisit `EXECUTE` dari `PUBLIC`, `anon`, dan `authenticated` pada seluruh fungsi di schema `public` (`get_database_size_bytes()`, `claim_next_run_item()`, `cleanup_old_checks_raw()`) dan memberi hak hanya ke `service_role`.
8. `supabase/migrations/20261029070000_function_search_path.sql` — Menetapkan `search_path = public, pg_temp` pada seluruh fungsi `SECURITY DEFINER` di schema `public` (`claim_next_run_item`, `get_database_size_bytes`, `cleanup_old_checks_raw`), memastikan prefix `public.` pada nama tabel, dan mempertahankan hak `EXECUTE` khusus `service_role`.

---

## 2. Langkah Impor Repositori ke Vercel (Tahap Uji Hobby)

1. Pastikan seluruh perubahan terbaru sudah di-commit dan di-push ke repositori GitHub Anda.
2. Masuk ke dasbor [Vercel](https://vercel.com/dashboard) dan klik **Add New...** -> **Project**.
3. Pilih repositori GitHub proyek ini lalu klik **Import**.
4. Pastikan **Framework Preset** terpilih **Next.js** dan biarkan pengaturan build sesuai bawaan (`next build`).
5. Tambahkan variabel lingkungan pada bagian 3 di bawah ini sebelum menekan **Deploy**.

---

## 3. Daftar Variabel Lingkungan (Nama Saja)

Seluruh variabel lingkungan terdaftar di `.env.example`. **Jangan pernah** menggunakan awalan `NEXT_PUBLIC_` untuk kunci rahasia:

### Variabel Wajib
| Nama Variabel | Keterangan Singkat |
| :--- | :--- |
| `SERPAPI_KEY` | Kunci API rahasia dari SerpApi (hanya diakses di server). |
| `SUPABASE_URL` | URL proyek Supabase (`https://<project-ref>.supabase.co`). |
| `SUPABASE_PUBLISHABLE_KEY` | Kunci publishable Supabase (`sb_publishable_...`). |
| `SUPABASE_SECRET_KEY` | Kunci secret/service_role Supabase (`sb_secret_...`, hanya di server). |
| `CRON_SECRET` | String acak minimal 32 karakter (misal hasil `openssl rand -hex 32`) untuk autentikasi `Authorization: Bearer <CRON_SECRET>` pada `/api/cron/*`. |
| `BRAND_DOMAIN` | Hostname domain merek utama tanpa protokol/garis miring (`linovhr.com`). |
| `SERPAPI_MAX_PER_HOUR` | Batas panggilan SerpApi per jam (`50` untuk paket Free, `200` untuk paket Starter). |
| `SERPAPI_DRY_RUN` | **Wajib diisi `false` di produksi.** Jika masih `true`, `npm run check:env` akan memberi peringatan (`WARN`) atau gagal (`FAIL` dengan `--production`). |
| `ALLOWED_EMAILS` | Daftar email pengguna yang diizinkan masuk ke dasbor, dipisahkan koma tanpa spasi. |

### Variabel Opsional (Netral Platform)
| Nama Variabel | Nilai Bawaan | Keterangan Singkat |
| :--- | :--- | :--- |
| `MAX_DURATION_MS` | `50000` | Batas waktu maksimal pemrosesan antrean per satu pemanggilan HTTP `/api/cron/process` dalam milidetik. |
| `APP_URL` | *(kosong)* | URL dasar aplikasi publik untuk pemeriksaan kesiapan produksi & penjadwal eksternal. |
| `SITE_URL` | *(kosong)* | URL situs publik untuk verifikasi `npm run check:env -- --production`. |
| `DATABASE_URL` | *(kosong)* | String koneksi Postgres (opsional, hanya dipakai oleh `npm run verify:db` dalam transaksi `READ ONLY`). |

---

## 4. Memeriksa Database (`npm run verify:db`)

Skrip `npm run verify:db` membandingkan manifest migrasi di repositori (`supabase/verify/manifest.json`) terhadap objek nyata di database Supabase Anda secara **baca-saja (read-only)** — tanpa menjalankan migrasi dan tanpa mengubah data apa pun.

### Jalur A: Pemeriksaan Otomatis dengan `DATABASE_URL` (Direkomendasikan)
1. Buka [Supabase Dashboard](https://supabase.com/dashboard) dan pilih proyek Anda.
2. Klik tombol **Connect** di bagian atas halaman dasbor.
3. Pada tab **Connection String** -> **URI**, salin string koneksi Postgres dan ganti `[YOUR-PASSWORD]` dengan kata sandi database Anda:
   - **Direct Connection** (`postgresql://postgres:[PASSWORD]@db.<project-ref>.supabase.co:5432/postgres`): Gunakan jika jaringan Anda mendukung IPv6.
   - **Session Pooler** (`postgresql://postgres.<project-ref>:[PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`): **Pilih opsi Session Pooler (port 5432)** jika koneksi langsung (*Direct Connection*) gagal akibat jaringan lokal hanya mendukung IPv4.
4. Tempelkan ke `.env.local` sebagai `DATABASE_URL=...`, lalu jalankan:
   ```bash
   npm run verify:db
   ```
5. Skrip akan membuka transaksi `BEGIN READ ONLY` (diakhiri `ROLLBACK`), memeriksa kategori `a` sampai `l`, mencetak laporan tabel per migrasi dan per kategori, serta menulis saran SQL perbaikan yang aman ke `supabase/verify/fix-suggestions.sql`.

### Jalur B: Tanpa `DATABASE_URL` (Lewat Supabase SQL Editor + OpenAPI/REST)
Jika `DATABASE_URL` dikosongkan:
1. Jalankan `npm run verify:db`. Skrip tidak akan gagal, melainkan:
   - Menghasilkan file `supabase/verify/verify.sql` yang berisi kueri SQL baca-saja (`SELECT` pada katalog sistem Postgres).
   - Melakukan pemeriksaan baca-saja otomatis melalui Supabase OpenAPI & REST API menggunakan `SUPABASE_SECRET_KEY` (kategori yang tidak diekspos oleh API akan berstatus `UNVERIFIED`).
2. Untuk memverifikasi seluruh kategori katalog Postgres (`pg_constraint`, `pg_indexes`, `pg_policy`, `pg_proc`, `pg_extension`, dan `pg_class`) secara penuh dengan status **Metode `DB`**:
   - Buka **Supabase Dashboard** -> **SQL Editor**.
   - Buka file `supabase/verify/verify.sql`, salin seluruh isinya, lalu klik **Run**.
   - Pada tabel hasil di kanan bawah, klik tombol **Export** -> **Export to CSV** dan simpan file (misal ke `hasil-verify.csv`), atau salin baris hasil dari grid SQL Editor.
   - Jalankan perintah:
     ```bash
     npm run verify:db -- --from-file hasil-verify.csv
     ```
   - Skrip akan membaca hasil eksekusi SQL Editor dan menyusun laporan konsistensi lengkap dengan **Metode `DB`** tanpa memerlukan `DATABASE_URL`.

---

## 5. Mengatur Site URL dan Redirect URLs di Supabase

1. Buka [Supabase Dashboard](https://supabase.com/dashboard) -> pilih proyek Anda -> **Authentication** -> **URL Configuration**.
2. Ubah **Site URL** dari `http://localhost:3000` menjadi domain aplikasi Anda (misal `https://<nama-proyek>.vercel.app` saat uji coba, atau `https://ai-overview.linovhr.com` saat di VPS).
3. Pada **Redirect URLs**, tambahkan URL callback autentikasi:
   ```text
   https://<nama-proyek>.vercel.app/auth/callback
   https://ai-overview.linovhr.com/auth/callback
   ```
4. Klik **Save**.

---

## 6. Penjadwalan pada Vercel Hobby & GitHub Actions

### A. Vercel Cron (`vercel.json`)
Paket **Vercel Hobby** hanya mengizinkan cron dijalankan maksimal **sekali sehari**. Oleh karena itu, `vercel.json` hanya memuat 2 jadwal:
1. `GET /api/cron/start-run` pada `0 1 * * 1` (**Senin pukul 01:00 UTC / 08:00 WIB**) — memulai run mingguan baru sekaligus membersihkan data `checks.raw` yang lebih tua dari 90 hari.
2. `GET /api/cron/process` pada `0 2 * * *` (**Setiap hari pukul 02:00 UTC / 09:00 WIB**) — menguras antrean yang mungkin tertinggal.

### B. GitHub Actions (`.github/workflows/process-queue.yml`)
Untuk memproses seluruh item antrean secara tuntas dengan tetap mematuhi batas laju per jam (`SERPAPI_MAX_PER_HOUR`), workflow `.github/workflows/process-queue.yml` berjalan:
- **Jadwal**: Setiap jam pada hari **Senin dan Selasa** (`0 * * * 1,2` UTC), ditambah pemicu manual `workflow_dispatch` dan `concurrency` group agar eksekusi tidak tumpang tindih.
- **Cara kerja**: Setiap eksekusi memanggil `POST /api/cron/process` berulang kali dengan jeda **20 detik** sampai salah satu kondisi terpenuhi:
  - `pending = 0` (seluruh keyword selesai diproses),
  - `stoppedReason = "rate_limit"` (batas laju per jam tercapai, akan dilanjutkan pada jam berikutnya), atau
  - waktu eksekusi mencapai **10 menit**.
- **Pengaturan GitHub Secrets**:
  Buka repositori GitHub -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**, lalu tambahkan:
  - `APP_URL`: URL aplikasi Anda (tanpa garis miring di akhir).
  - `CRON_SECRET`: Nilai yang sama persis dengan `CRON_SECRET` di aplikasi.

### C. Perhitungan Perkiraan Menit GitHub Actions per Bulan
- **Frekuensi pemicu**: 24 kali sehari × 2 hari (Senin & Selasa) = **48 eksekusi/minggu** ($\approx 209$ eksekusi/bulan).
- **Eksekusi saat antrean aktif** (biasanya 1–2 jam pertama setelah Senin `01:00 UTC` untuk 50–100 keyword):
  - Sekitar `2 eksekusi/minggu × 4 menit × 4,35 minggu` $\approx$ **35 menit/bulan**.
- **Eksekusi saat antrean sudah kosong (`pending = 0`)**:
  - Endpoint `/api/cron/process` memiliki jalur cepat (*fast-path*) yang langsung mengembalikan HTTP `200` (`pending: 0, stoppedReason: "queue_empty"`) dalam `< 1 detik` pada iterasi pertama dan langsung menghentikan loop.
  - Total waktu kerja riil per eksekusi kosong adalah ~5–10 detik, yang dibulatkan oleh GitHub Actions menjadi **1 menit tagihan per eksekusi**: `46 eksekusi/minggu × 1 menit × 4,35 minggu` $\approx$ **200 menit/bulan**.
- **Total perkiraan pemakaian per bulan**: **~235 menit/bulan** (hanya ~11,7% dari kuota gratis GitHub Actions sebesar **2.000 menit/bulan** untuk repositori privat, atau gratis tanpa batas untuk repositori publik).

---

## 7. Panduan Pindah dari Vercel Hobby ke VPS Sendiri

Aplikasi dirancang sepenuhnya netral terhadap platform (tanpa `@vercel/*`, KV, Edge Config, Blob, atau header khusus Vercel). Saat masa uji di Vercel selesai dan Anda memindahkan aplikasi ke VPS Linux sendiri:

1. **Jalankan aplikasi Next.js standar**:
   - Salin `.env` produksi di VPS (dapat menaikkan `MAX_DURATION_MS=120000` bila diinginkan).
   - Bangun dan jalankan dengan `npm run build && npm run start` di belakang reverse proxy (Nginx / Caddy) dan process manager (systemd / PM2).
2. **Matikan GitHub Actions & ganti dengan `crontab` sistem di VPS**:
   - Buat variabel repositori GitHub `ENABLE_QUEUE_WORKFLOW=false` (atau hapus proyek di Vercel).
   - Tambahkan dua baris berikut di `crontab -e` pada VPS Anda:
     ```cron
     # Mulai run mingguan setiap Senin pukul 01:00 UTC (08:00 WIB)
     0 1 * * 1 curl -fsS -X POST http://127.0.0.1:3000/api/cron/start-run -H "Authorization: Bearer <CRON_SECRET>" >/dev/null

     # Proses antrean setiap 5 menit (langsung kembali <1 detik jika tidak ada item pending)
     */5 * * * * curl -fsS -X POST http://127.0.0.1:3000/api/cron/process -H "Authorization: Bearer <CRON_SECRET>" >/dev/null
     ```

---

## 8. Urutan Go-Live

1. Jalankan kedelapan file migrasi di `supabase/migrations/` sesuai urutan pada bagian 1, lalu verifikasi konsistensi dengan `npm run verify:db`.
2. Bersihkan seluruh data contoh (`is_demo = true`) dari database:
   ```bash
   npm run seed:clear
   ```
3. Pastikan `SERPAPI_DRY_RUN=false` pada konfigurasi lingkungan produksi.
4. Jalankan pemeriksaan kesiapan produksi:
   ```bash
   npm run check:env -- --production
   ```
   Pastikan seluruh pemeriksaan berstatus **PASS** (`FAIL=0`).
5. Masuk ke dasbor produksi dengan email yang terdaftar di `ALLOWED_EMAILS`, impor daftar keyword, dan uji pemanggilan pertama lewat tombol **"Jalankan cek sekarang"** di halaman **Pengaturan** atau tombol **Run workflow** di GitHub Actions.
