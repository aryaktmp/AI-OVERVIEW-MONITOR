-- Migrasi 20261102000000_single_running_run.sql:
-- Mencegah kondisi balapan (race condition) sehingga maksimal hanya ada SATU check_runs berstatus 'running'.
--
-- Catatan penting:
-- Pembuatan indeks unik akan gagal jika di database sudah terdapat lebih dari satu baris check_runs berstatus 'running'.
-- Oleh karena itu, kita tutup terlebih dahulu kelebihan baris running (jika ada), mempertahankan hanya run running terbaru.

DO $$
BEGIN
  -- Tutup run berstatus 'running' yang duplikat/lama menjadi 'failed'
  UPDATE public.check_runs
  SET status = 'failed',
      finished_at = COALESCE(finished_at, now())
  WHERE status = 'running'
    AND id NOT IN (
      SELECT id
      FROM public.check_runs
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    );
END $$;

-- Buat indeks unik parsial: hanya satu run yang diizinkan memiliki status 'running' secara bersamaan
CREATE UNIQUE INDEX IF NOT EXISTS check_runs_single_running_idx
ON public.check_runs (status)
WHERE status = 'running';
