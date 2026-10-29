# Spesifikasi: Pemantau Kutipan Google AI Overview untuk LinovHR

## Tujuan

Sistem web untuk mengecek apakah LinovHR muncul di Google AI Overview. Keyword bebas. Keyword tidak terbatas pada topik HR.

- Domain perusahaan: `linovhr.com` (situs: https://www.linovhr.com/)
- Target pasar: Indonesia, bahasa Indonesia
- Volume: 150 keyword per minggu (sekitar 650 pencarian per bulan)
- Sumber data: SerpApi (API pihak ketiga). Tanpa scraping manual.

## Tiga tingkat deteksi

Sistem memeriksa tiga hal untuk setiap keyword.

1. **Domain dikutip.** Hostname `linovhr.com` atau subdomainnya (misal `www.linovhr.com`) ada di daftar sumber AI Overview.
2. **Nama disebut di teks.** Teks jawaban AI Overview memuat salah satu istilah merek.
3. **Disebut di sumber lain.** Sumber pihak ketiga yang dikutip (artikel review, daftar software, direktori) memuat istilah merek atau link ke `linovhr.com`. Sistem mengambil halaman sumber itu dan mencarinya.

Status akhir per cek:

| Status | Arti |
|---|---|
| `no_ai_overview` | Google tidak menampilkan AI Overview untuk keyword ini |
| `not_detected` | AI Overview muncul, tiga tingkat deteksi semuanya negatif |
| `detected` | Minimal satu tingkat deteksi positif |

Simpan juga tiga flag terpisah: `detected_domain`, `detected_text`, `detected_third_party`.

## Pencocokan merek

- Istilah awal: `LinovHR`, `Linov HR`, `linovhr.com`. Admin bisa menambah atau menghapus istilah di halaman Pengaturan.
- Abaikan huruf besar dan kecil. Cocokkan sebagai kata utuh.
- Jangan pakai `Linov` sendirian secara bawaan. Terlalu banyak hasil palsu. Sediakan sebagai opsi yang mati.
- Pencocokan domain memakai hostname dari URL, bukan pencarian teks. `linovhr.com` cocok. `notlinovhr.com` tidak cocok.

## Stack

- Next.js terbaru, App Router, TypeScript
- Tailwind CSS dan shadcn/ui
- Recharts untuk grafik, TanStack Table untuk tabel
- Supabase: PostgreSQL, Auth, Row Level Security
- Zod untuk validasi input
- Vitest untuk pengujian
- Deploy: Vercel

## Variabel lingkungan

Buat `.env.example` dengan nama berikut. Jangan commit nilai asli.

```
SERPAPI_KEY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
CRON_SECRET=
BRAND_DOMAIN=linovhr.com
SERPAPI_MAX_PER_HOUR=50
ALLOWED_EMAILS=
```

`SERPAPI_MAX_PER_HOUR` bernilai 50 untuk paket gratis dan 200 untuk paket Starter.

## Skema database

```sql
create table keyword_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table keywords (
  id uuid primary key default gen_random_uuid(),
  text text not null unique,
  group_id uuid references keyword_groups(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table brand_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null unique,
  enabled boolean not null default true
);

create table competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique
);

create table check_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- running, done, failed
  total int not null default 0,
  done int not null default 0
);

create table run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references check_runs(id) on delete cascade,
  keyword_id uuid not null references keywords(id) on delete cascade,
  state text not null default 'pending',   -- pending, processing, done, error
  attempts int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);

create table checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references check_runs(id) on delete cascade,
  keyword_id uuid not null references keywords(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null,                    -- no_ai_overview, not_detected, detected
  answer_text text,
  detected_domain boolean not null default false,
  detected_text boolean not null default false,
  detected_third_party boolean not null default false,
  raw jsonb
);

create table check_sources (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references checks(id) on delete cascade,
  position int not null,
  title text,
  url text not null,
  domain text not null,
  is_own boolean not null default false,
  is_competitor boolean not null default false,
  mentions_brand boolean not null default false
);

create table page_cache (
  url text primary key,
  fetched_at timestamptz not null default now(),
  mentions_brand boolean not null,
  status int
);

create index on checks (keyword_id, checked_at desc);
create index on run_items (run_id, state);
create index on check_sources (check_id);
```

Aktifkan RLS di semua tabel. Hanya pengguna login yang boleh membaca. Penulisan data hanya lewat server dengan service role.

## Alur pengecekan

1. Endpoint `POST /api/cron/start-run` membuat satu `check_runs` dan satu `run_items` untuk setiap keyword aktif.
2. Endpoint `POST /api/cron/process` mengambil item `pending`, memproses sebanyak mungkin dalam batas waktu fungsi, lalu berhenti. Cron memanggilnya tiap 5 menit sampai semua item selesai.
3. Untuk setiap item:
   1. Panggil SerpApi dengan `engine=google`, `q=<keyword>`, `google_domain=google.co.id`, `gl=id`, `hl=id`, `location=Indonesia`.
   2. Baca objek `ai_overview`. Jika respons hanya memberi `page_token`, panggil `engine=google_ai_overview` dengan token itu. Token cepat kedaluwarsa, jadi panggil segera.
   3. Jika tidak ada AI Overview, simpan status `no_ai_overview`.
   4. Jika ada, ambil teks jawaban dan daftar referensi. Simpan ke `checks` dan `check_sources`.
   5. Jalankan deteksi tingkat 1 dan 2.
   6. Jalankan deteksi tingkat 3 untuk sumber yang bukan domain sendiri (lihat bagian berikutnya).
   7. Hitung status akhir dan tandai item `done`.
4. Jika semua item selesai, tandai `check_runs` sebagai `done`.

Verifikasi struktur respons SerpApi di dokumentasi resmi sebelum menulis parser. Nama field bisa berubah. Simpan respons mentah di kolom `raw` untuk debugging.

## Deteksi sumber pihak ketiga

- Ambil halaman dengan batas waktu 8 detik dan ukuran maksimal 500 KB.
- Cari istilah merek di teks halaman dan cari link yang mengarah ke `linovhr.com`.
- Simpan hasil di `page_cache`. Pakai cache selama 7 hari.
- Lindungi dari SSRF: hanya `http` dan `https`, tolak IP privat dan `localhost`, batasi pengalihan sampai 3 kali.
- Sediakan pengaturan untuk mematikan tingkat 3 jika waktu proses atau biaya menjadi masalah.

## Batas laju dan kegagalan

- Patuhi `SERPAPI_MAX_PER_HOUR`. Hitung dari item yang selesai dalam 60 menit terakhir.
- Ulangi item gagal maksimal 2 kali dengan jeda bertambah. Setelah itu tandai `error` dan simpan pesannya.
- Satu item gagal tidak menghentikan run.

## Halaman

1. **Login.** Supabase Auth dengan email. Hanya email di `ALLOWED_EMAILS` yang boleh masuk.
2. **Ringkasan.** Kartu statistik (keyword dipantau, AI Overview muncul, LinovHR terdeteksi, tingkat deteksi, selisih dari minggu lalu). Grafik tren 8 minggu. Peta status keyword per minggu.
3. **Keyword.** Tabel dengan pencarian, filter grup, filter status. Tambah keyword satuan. Impor CSV dengan kolom `keyword,group`. Hapus dan nonaktifkan keyword. Kolom jenis deteksi.
4. **Detail keyword.** Riwayat cek. Teks AI Overview lengkap dengan istilah merek ditandai. Daftar sumber, dengan penanda sumber sendiri dan sumber kompetitor.
5. **Kompetitor.** Domain yang paling sering dikutip untuk keyword yang sama. Domain sendiri dan domain di tabel `competitors` diberi penanda.
6. **Pengaturan.** Istilah merek, daftar kompetitor, lokasi dan bahasa, tombol "Jalankan cek sekarang", saklar tingkat 3.
7. **Ekspor.** Unduh hasil ke CSV.

Setiap halaman perlu kondisi kosong yang memberi arahan, kondisi memuat, dan kondisi galat.

## Jadwal

- Mulai run: tiap Senin 08:00 WIB (`0 1 * * 1` dalam UTC).
- Proses antrean: tiap 5 menit.
- Lindungi semua endpoint cron dengan header `Authorization: Bearer <CRON_SECRET>`.
- Vercel paket Hobby hanya mengizinkan cron sekali sehari. Jika memakai Hobby, buat workflow GitHub Actions dengan `schedule` untuk memanggil endpoint tiap 5 menit.

## Struktur folder yang diharapkan

```
app/
  (auth)/login/
  (dashboard)/ringkasan/
  (dashboard)/keyword/
  (dashboard)/keyword/[id]/
  (dashboard)/kompetitor/
  (dashboard)/pengaturan/
  api/cron/start-run/route.ts
  api/cron/process/route.ts
  api/keywords/import/route.ts
  api/export/route.ts
lib/
  serpapi.ts        klien SerpApi
  detect.ts         tiga tingkat deteksi
  queue.ts          pengambilan item dan batas laju
  fetch-page.ts     pengambilan halaman dengan perlindungan SSRF
  supabase/
supabase/migrations/
tests/
```

## Pengujian

- Unit test `detect.ts` dengan data contoh: domain cocok, subdomain cocok, domain mirip tidak cocok, nama merek di teks, tanpa AI Overview.
- Unit test parser SerpApi memakai fixture JSON yang disimpan di `tests/fixtures/`.
- Tes batas laju dan percobaan ulang.
- Tes `fetch-page.ts` menolak IP privat.

## Fase kerja dan kriteria selesai

| Fase | Isi | Selesai jika |
|---|---|---|
| 0 | Inisialisasi proyek, Tailwind, shadcn/ui, `.env.example`, README | `npm run dev` berjalan |
| 1 | Migrasi database, RLS, login dengan allowlist | Pengguna di luar allowlist ditolak |
| 2 | Klien SerpApi, parser, `detect.ts` tingkat 1 dan 2, tes dengan fixture | Semua tes lulus |
| 3 | Antrean, endpoint cron, batas laju, percobaan ulang | Run 10 keyword selesai di lingkungan lokal |
| 4 | Halaman Ringkasan, Keyword, Detail, Kompetitor, Pengaturan | Semua halaman memuat data nyata |
| 5 | Deteksi tingkat 3, cache, perlindungan SSRF | Tes SSRF lulus |
| 6 | Ekspor CSV, impor CSV, deploy ke Vercel, jadwal cron | Run terjadwal berjalan sendiri |

## Referensi tampilan

Prototipe visual ada di `dashboard-ai-overview.html`. Ikuti susunan halaman, peta status, dan istilah di dalamnya. Data di prototipe hanya contoh.
