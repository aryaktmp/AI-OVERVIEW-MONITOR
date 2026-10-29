import Link from "next/link";
import { getCompetitorPageData } from "@/lib/dashboard-data";
import { DemoDataBanner } from "@/components/demo-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function KompetitorPage() {
  const { ranking, competitors, hasDemoData, totalChecksAnalyzed } =
    await getCompetitorPageData();

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
            Domain yang Paling Sering Dikutip
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            Dari keyword yang sama ({totalChecksAnalyzed} keyword yang sudah
            dicek), domain mana yang paling sering muncul di AI Overview.
          </p>
        </div>

        <Link href="/pengaturan">
          <Button variant="secondary" size="sm">
            Kelola daftar kompetitor
          </Button>
        </Link>
      </div>

      <DemoDataBanner visible={hasDemoData} />

      {ranking.length === 0 || totalChecksAnalyzed === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center">
          <h2 className="text-[15px] font-semibold text-[var(--ink)]">
            Belum ada kutipan domain yang tercatat
          </h2>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--muted)]">
            Jalankan pengecekan keyword terlebih dahulu atau muat data contoh
            untuk melihat peringkat domain yang dikutip oleh Google AI Overview.
          </p>
          <div className="mt-4 flex justify-center gap-2.5">
            <Link href="/pengaturan">
              <Button variant="primary">Buka pengaturan &amp; jalankan cek</Button>
            </Link>
            <Link href="/keyword">
              <Button variant="secondary">Lihat daftar keyword</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="mb-3.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">
              Domain Dikutip per Jumlah Keyword
            </h2>
            <span className="text-[12px] text-[var(--muted)]">
              Dihitung dari hasil cek terbaru tiap keyword
            </span>
          </div>

          <div className="space-y-2">
            {ranking.map((row) => (
              <div
                key={row.domain}
                className="grid grid-cols-1 items-center gap-2 text-[13px] sm:grid-cols-[200px_1fr_90px] sm:gap-2.5"
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={
                      row.isOwn
                        ? "font-semibold text-[var(--cite)]"
                        : "font-medium text-[var(--ink)]"
                    }
                  >
                    {row.domain}
                    {row.isOwn ? " (Anda)" : ""}
                  </span>
                  {row.isCompetitor && (
                    <Badge variant="notDetected">Kompetitor</Badge>
                  )}
                </div>

                <div className="h-[18px] overflow-hidden rounded bg-[#F1F5F9]">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${Math.max(row.keywordCount > 0 ? 4 : 0, row.percentageOfMax)}%`,
                      backgroundColor: row.isOwn ? "var(--cite)" : "#64748B",
                    }}
                  />
                </div>

                <div className="font-mono text-[12px] text-[var(--muted)] sm:text-right">
                  {row.keywordCount} keyword
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daftar Kompetitor Terdaftar */}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[var(--ink)]">
            Kompetitor yang Dipantau ({competitors.length})
          </h2>
          <Link
            href="/pengaturan"
            className="text-[12px] font-medium text-[var(--brand)] hover:underline"
          >
            Tambah atau ubah di Pengaturan →
          </Link>
        </div>

        {competitors.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            Belum ada kompetitor yang didaftarkan. Tambahkan domain kompetitor
            di halaman Pengaturan untuk menandai kutipan kompetitor secara
            otomatis.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {competitors.map((c) => (
              <div
                key={c.id}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-[#F8FAFC] px-3 py-1.5 text-[12.5px]"
              >
                <span className="font-medium text-[var(--ink)]">{c.name}</span>
                <span className="font-mono text-[11.5px] text-[var(--muted)]">
                  {c.domain}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
