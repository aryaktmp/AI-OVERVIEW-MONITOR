# DESIGN.md — LinovHR AI Overview Monitor

Sumber kebenaran desain UI. Token berasal dari `app/globals.css`; komponen dari `components/ui/*`. Jika dokumen ini berbeda dengan kode, kode yang benar — perbarui dokumen ini.

## 1. Prinsip Desain
- **Data dulu**: dasbor analitik internal; informasi padat tapi terbaca, bukan dekoratif.
- **Tenang & netral**: latar abu-biru sejuk, kartu putih, satu warna aksen teal (`--cite`) untuk makna "terdeteksi/positif".
- **Makna warna konsisten**: teal = LinovHR terdeteksi/sukses, amber = AI Overview ada tapi tidak mengutip/peringatan, abu = tidak ada data, merah = galat/destruktif.
- **Konsisten > kreatif**: pakai komponen & token yang ada sebelum membuat yang baru.
- **Aksesibel**: kontras cukup, fokus terlihat, tidak mengandalkan warna saja, hormati `prefers-reduced-motion`.

## 2. Design Tokens (`app/globals.css`)
| Token | Light | Dark | Peran |
|---|---|---|---|
| `--bg` | `#F3F5F7` | `#10171E` | Latar halaman |
| `--surface` | `#FFFFFF` | `#18222B` | Kartu, input, popover |
| `--ink` | `#14202B` | `#E8EEF3` | Teks utama |
| `--muted` | `#586674` | `#98A6B3` | Teks sekunder, label |
| `--line` | `#DCE2E8` | `#2A3743` | Border, pemisah |
| `--cite` / `--brand` | `#0E6B62` | `#5FD0C2` | Aksen utama, tombol primary, fokus, "terdeteksi" |
| `--cite-bg` | `#CFEBE6` | `#1B4A46` | Latar status terdeteksi |
| `--seen` | `#B7791F` | `#E3B04B` | Peringatan / AI Overview tanpa kutipan |
| `--seen-bg` | `#F6E3B8` | `#4B3A16` | Latar status peringatan |
| `--none` | `#E6EAEE` | `#243039` | Latar netral, hover, sel kosong |
| `--accent` | `#14202B` | `#E8EEF3` | Tombol default / badge default (kontras tinggi) |
| `--destructive` | `#C0392B` | `#C0392B` | Aksi berbahaya, galat |

- Token semantik shadcn (`--background`, `--primary`, `--border`, `--ring`, …) memetakan ke token di atas — jangan menimpanya terpisah.
- Dark mode otomatis via `prefers-color-scheme` (kecuali `data-theme="light"`); setiap warna baru **wajib** punya pasangan dark.
- Radius dasar `--radius: 0.5rem`.

## 3. Tipografi
- Font: **Plus Jakarta Sans** (`--font-jakarta`, bobot 400/500/600/800), fallback `system-ui`.
- Dasar `15px / 1.5`.
- Skala yang dipakai: judul halaman `text-[22px] font-extrabold tracking-tight`; judul kartu `text-base font-extrabold`; angka KPI `text-[28px] font-extrabold leading-none tracking-tight`; teks isi `text-sm`; label/meta `text-xs font-semibold` (warna `--muted`).
- Hanya bobot 400/500/600/800; hindari ukuran/bobot baru.

## 4. Layout & Spasi
- Kontainer: `mx-auto max-w-[1040px] px-4 pt-6 pb-12` (lihat `app/(dashboard)/layout.tsx`).
- Header: judul kiri, email + `Sign out` (outline/sm) kanan, `flex-wrap`.
- Navigasi tab bergaris bawah (`components/dashboard-nav.tsx`): aktif `border-b-[3px]` warna `--accent`, `overflow-x-auto`.
- Ritme vertikal: `space-y-5` antar blok; grid KPI `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`; padding kartu KPI `p-4`.
- Mobile-first; tabel lebar dibungkus `overflow-auto`.

## 5. Komponen (`components/ui/*`)
- **Button** (`cva`): varian `default` (aksen gelap), `primary` (teal, CTA utama), `secondary`/`outline`, `ghost`, `link`, `destructive`; ukuran `default h-9`, `sm h-8`, `lg h-10`, `icon`. Satu CTA `primary` per area; gunakan `asChild` + `Link` untuk navigasi.
- **Card**: permukaan `--surface`, border `--line`; `CardHeader/Title/Description/Content`. Kartu KPI: label `text-xs` + ikon `h-4 w-4` kanan atas, angka besar di bawah.
- **Badge** (pil): `cited`/`detected` (teal), `notDetected` (amber), `none` (abu), `outline`, `secondary`.
- **Alert**: `default`, `success`, `warning`, `destructive`, `info`; ikon lucide `h-4 w-4`. `DemoDataBanner` memakai `warning`.
- **Input/Select/Textarea/Label/Switch/Tabs/Dialog/Tooltip/Table/Progress/Separator**: ikuti varian yang ada; tinggi kontrol `h-9`, border `--line`, fokus `outline-2 outline-[var(--cite)]`.
- Komponen fitur (`weekly-trend-chart`, `batch-scheduler-card`, `keyword-multi-select-dropdown`, …) harus tersusun dari primitif di atas.

## 6. Pola Halaman
- **Overview**: baris KPI (4 kartu + `DeltaBadge`), kartu tren mingguan (Recharts), heatmap per grup keyword (sel `h-[22px] rounded-[3px]`: 2 = `--cite`, 1 = `--seen-bg` + ring `--seen`, 0 = `--none`).
- **Empty state**: `Card` dengan judul + deskripsi + 1–2 tombol aksi (primary + outline).
- **Loading**: `loading.tsx` dengan skeleton `animate-pulse` yang meniru layout, `aria-busy`/`aria-live`.
- **Error**: `error.tsx` per segmen dengan pesan ramah + aksi coba lagi.
- **Form**: label di atas input, pesan validasi spesifik (Zod), tombol submit menonaktifkan diri saat pending.
- **Tabel/daftar**: header `text-xs` muted, baris dipisah `border-[var(--line)]`, aksi destruktif memakai Dialog konfirmasi.

## 7. Ikon, Gerak, Aksesibilitas
- Ikon: `lucide-react`, ukuran `h-4 w-4` (inline) — `stroke` bawaan; ikon dekoratif `aria-hidden`.
- Gerak: halus & singkat (≤ 250 ms), mis. `animate-tab-fade-in`; wajib nonaktif pada `prefers-reduced-motion`.
- A11y: `aria-label` pada nav/ikon-tombol, `aria-current="page"`, label terhubung ke input, fokus `focus-visible`, target klik ≥ 32px, status tidak hanya lewat warna (sertakan teks/ikon).

## 8. Bahasa Antarmuka
- Teks UI: **bahasa Inggris**, singkat, kalimat sentence-case ("Add first keyword", "Sign out").
- URL rute: bahasa Indonesia (`/ringkasan`, `/keyword`, `/kompetitor`, `/pengaturan`); label nav: Overview, Keywords & Batches, Competitors, Settings.

## 9. Ketidakkonsistenan Diketahui (utang desain)
Perbaiki bertahap saat menyentuh berkas terkait; jangan memperluasnya.
- Warna destruktif di-hardcode `#C0392B` di `button`, `badge`, `alert`, `DeltaBadge` → pakai token `--destructive`.
- Varian `Badge.brand` dan `Alert.info` memakai palet biru Tailwind di luar token → definisikan token info/brand atau ganti ke token yang ada.
- Dua badge `cited` dan `detected` identik; konsolidasikan.
- Mojibake pada beberapa string (mis. "linovhr.com A� Google Indonesia", panah di `DemoDataBanner`) → pastikan UTF-8 (`·`, `→`).
- Tambahkan varian dark untuk `--destructive` bila kontras kurang.
