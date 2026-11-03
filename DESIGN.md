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
| `--surface-hover` | `#F8FAFC` | `#1E2B36` | State hover kartu & dropdown |
| `--ink` | `#14202B` | `#E8EEF3` | Teks utama |
| `--muted` | `#586674` | `#98A6B3` | Teks sekunder, label |
| `--line` | `#DCE2E8` | `#2A3743` | Border, pemisah |
| `--primary` / `--cite` / `--brand` | `#0E6B62` | `#5FD0C2` | Aksen utama, tombol primary, fokus, "terdeteksi" |
| `--primary-subtle` / `--cite-bg` | `#CFEBE6` | `#1B4A46` | Latar status terdeteksi |
| `--success-text` | `#084C45` | `#7EE0D4` | Teks sukses berdaya kontras tinggi (WCAG AA/AAA) |
| `--warning` / `--seen` | `#B7791F` | `#E3B04B` | Peringatan / AI Overview tanpa kutipan |
| `--warning-bg` / `--seen-bg` | `#FEF3C7` | `#3D2E0B` | Latar status peringatan |
| `--warning-border` | `#FDE68A` | `#5C4512` | Border status peringatan |
| `--warning-text` | `#78350F` | `#FDE68A` | Teks peringatan kontras tinggi (WCAG AAA >= 7:1) |
| `--destructive` / `--error` | `#C0392B` | `#E74C3C` | Aksi berbahaya, galat |
| `--destructive-bg` | `#FEE2E2` | `#3B1414` | Latar galat / invalid |
| `--destructive-border` | `#FECACA` | `#601E1E` | Border galat / invalid |
| `--destructive-text` | `#991B1B` | `#FCA5A5` | Teks galat kontras tinggi (WCAG AAA >= 7:1) |
| `--secondary` / `--none` | `#E6EAEE` | `#243039` | Latar netral, hover, sel kosong |
| `--accent` | `#14202B` | `#E8EEF3` | Tombol default / badge default (kontras tinggi) |
| `--disabled-bg` | `#E2E8F0` | `#1F2933` | Latar elemen nonaktif |
| `--disabled-fg` | `#94A3B8` | `#64748B` | Teks elemen nonaktif |

- Token semantik shadcn (`--background`, `--primary`, `--border`, `--ring`, …) memetakan ke token di atas — jangan menimpanya terpisah.
- Dark mode otomatis via `prefers-color-scheme` (kecuali `data-theme="light"`); setiap warna baru **wajib** punya pasangan dark.
- Radius dasar `--radius: 0.5rem`.

## 3. Tipografi
- Font: **Plus Jakarta Sans** (`--font-jakarta`, bobot 400/500/600/800), fallback `system-ui`.
- Dasar `15px / 1.5`.
- Skala yang dipakai: judul halaman `text-[22px] font-extrabold tracking-tight`; judul kartu `text-base font-extrabold`; angka KPI `text-[28px] font-extrabold leading-none tracking-tight`; teks isi `text-sm`; label/meta `text-xs font-semibold` (warna `--muted`).
- Hanya bobot 400/500/600/800; hindari ukuran/bobot baru.

## 4. Layout & Spasi
- Kontainer: `mx-auto max-w-[1040px] px-4` (lihat `app/(dashboard)/layout.tsx`).
- Header & Navigasi Utama Sticky: `sticky top-0 z-40 w-full border-b border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur-md` (tinggi ~105px, token `--top-nav-height` disinkronkan dinamis lewat `ResizeObserver` di `components/dashboard-nav.tsx`). Judul kiri, email + `Sign out` (outline/sm) kanan, navigasi tab bergaris bawah (`components/dashboard-nav.tsx`) aktif `border-b-[2.5px]` warna `--accent`, `overflow-x-auto`.
- Sub-Tab Hub Sticky: Pada halaman dengan sub-tab (mis. Keywords & Batches Hub), header title dan sub-tab list menggunakan `sticky z-30 bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--line)]` dengan `style={{ top: "var(--top-nav-height, 105px)" }}` sehingga tetap menempel tepat mepet di bawah navigasi utama saat di-scroll.
- Layering Z-Index: Modals/Dialogs (`z-50`) > Top Nav Header (`z-40`) > Sub-Tab Hub Header (`z-30`) > Frozen Table Headers (`z-20`) > Frozen Table Body Cells (`z-10`).
- Ritme vertikal: `space-y-5` antar blok; grid KPI `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`; padding kartu KPI `p-4`.
- Mobile-first; tabel lebar dibungkus `overflow-auto`.
- Scrollbar Halus & Non-Intrusif: Seluruh scrollbar elemen horizontal/vertikal (termasuk tabel, grafik, kartu analitik, dropdown, modal) menggunakan styling custom yang ramping (`scrollbar-width: thin`, tinggi/lebar 5–6px, sudut bulat penuh, background track transparan, dan thumb berbasis `var(--muted)` yang menyatu dengan latar belakang). Tersedia utility `.custom-scrollbar` untuk kartu/tabel analitik dan `.no-scrollbar` untuk tab navigasi.

## 5. Komponen (`components/ui/*`)
- **Button** (`cva`): varian `default` (aksen gelap), `primary` (teal, CTA utama), `secondary`/`outline`, `ghost`, `link`, `destructive`; ukuran `default h-9`, `sm h-8`, `lg h-10`, `icon`. Satu CTA `primary` per area; gunakan `asChild` + `Link` untuk navigasi.
- **Card**: permukaan `--surface`, border `--line`; `CardHeader/Title/Description/Content`. Kartu KPI: label `text-xs` + ikon `h-4 w-4` kanan atas, angka besar di bawah.
- **Badge** (pil): `cited`/`detected` (teal), `notDetected` (amber), `none` (abu), `outline`, `secondary`.
- **Alert**: `default`, `success`, `warning`, `destructive`, `info`; ikon lucide `h-4 w-4`. `DemoDataBanner` memakai `warning`.
- **Input/Select/Textarea/Label/Switch/Tabs/Dialog/Tooltip/Table/Progress/Separator**: ikuti varian yang ada; tinggi kontrol `h-9`, border `--line`, fokus `outline-2 outline-[var(--cite)]`.
- **DataTablePagination** (`components/ui/data-table-pagination.tsx`): Komponen standar pagination untuk tabel data banyak (TanStack Table). Menyediakan pemilih rows per page (`10`, `25`, `50`, `100`), status rentang baris (`Showing X–Y of Z items`), indikator jumlah baris terpilih (`X of Y selected`), dan tombol navigasi responsif (`First`, `Previous`, `Next`, `Last`). Didukung oleh modul kalkulasi dan pemotongan data standar di `lib/pagination.ts`.
- Komponen fitur (`weekly-trend-chart`, `batch-scheduler-card`, `keyword-multi-select-dropdown`, …) harus tersusun dari primitif di atas.

## 6. Pola Halaman
- **Overview**:
  - Header dengan tombol ekspor laporan multi-format (`ExportDataDialog`: Workbook Excel `.xlsx` dengan template rapi 2 sheet, freeze panes, auto-filter, opsi fallback CSV, serta standar flow loading state asinkron berbasis `fetch` + Blob URL).
  - Baris KPI 4 kartu (Keywords monitored, Active Rotation Batch, AI Overview present, LinovHR detection rate).
  - Widget status batch mingguan (`OverviewActiveBatchWidget`: batch aktif, interval rotasi, alokasi kuota bulanan, timeline 4 slot mingguan).
  - Dua chart interaktif Recharts berdampingan (`grid-cols-1 lg:grid-cols-2`): tren detection rate mingguan (Line Chart) dan perbandingan sitasi per grup modul LinovHR (Bar Chart).
  - Heatmap per grup keyword 8 minggu terakhir (`OverviewHeatmapCard`: dilengkapi pencarian keyword real-time, filter grup produk & status, paginasi standar 15 baris per halaman, mode accordion terkelompok, sel `h-[22px] rounded-[3px]`: 2 = `--cite`, 1 = `--seen-bg` + ring `--seen`, 0 = `--none`, serta tombol ekspor matriks).
- **Empty state**: `Card` dengan judul + deskripsi + 1–2 tombol aksi (primary + outline).
- **Loading & Komunikasi Backend**: Wajib ada loading behavior di SETIAP proses atau komunikasi ke Backend (*"Zero Silent BE Operations"*): (1) Skeleton `loading.tsx` untuk pemuatan rute halaman awal, (2) Spinner `Loader2 animate-spin` + teks status aktif ("Saving...", "Generating...") + kontrol `disabled` pada tombol & input untuk mencegah submit ganda, (3) Spinner baris lokal (`pendingActionId`) untuk aksi in-line tabel, dan (4) Umpan balik galat eksplisit jika komunikasi backend gagal.
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
- ~~Warna destruktif di-hardcode `#C0392B` di `button`, `badge`, `alert`, `DeltaBadge`~~ → Sekarang memakai token `--destructive`, `--destructive-bg`, `--destructive-text`.
- ~~Varian `Badge.brand` dan `Alert.info` memakai palet biru Tailwind di luar token~~ → Sekarang memakai token semantik `--primary-subtle` dan `--primary`.
- ~~Tambahkan varian dark untuk `--destructive` bila kontras kurang~~ → Telah ditambahkan `--destructive: #E74C3C`, `--destructive-bg: #3B1414`, `--destructive-text: #FCA5A5` (kontras WCAG AAA).
- Dua badge `cited` dan `detected` identik; konsolidasikan.
- Mojibake pada beberapa string (mis. "linovhr.com A� Google Indonesia", panah di `DemoDataBanner`) → pastikan UTF-8 (`·`, `→`).
- Tambahkan varian dark untuk `--destructive` bila kontras kurang.
