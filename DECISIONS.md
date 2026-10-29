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
