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
