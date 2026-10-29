import Link from "next/link";

export function DemoDataBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--seen)]/40 bg-[var(--seen-bg)] px-4 py-2.5 text-xs font-medium text-[var(--seen)]"
    >
      <span>
        <strong>Data contoh:</strong> Halaman ini memuat hasil dari pengecekan
        simulasi (dry-run / contoh).
      </span>
      <Link
        href="/pengaturan"
        className="font-bold underline hover:opacity-80"
      >
        Kelola atau hapus data contoh di Pengaturan
      </Link>
    </div>
  );
}
