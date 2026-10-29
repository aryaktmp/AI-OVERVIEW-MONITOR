import Link from "next/link";
import { notFound } from "next/navigation";
import { getKeywordDetailData } from "@/lib/dashboard-data";
import {
  formatDetectionTypeLabel,
  splitTextByBrandTerms,
} from "@/lib/analytics";
import { DemoDataBanner } from "@/components/demo-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CheckStatus } from "@/lib/detect";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: CheckStatus }) {
  if (status === "detected") {
    return <Badge variant="cited">Terdeteksi</Badge>;
  }
  if (status === "not_detected") {
    return <Badge variant="notDetected">Tidak terdeteksi</Badge>;
  }
  return <Badge variant="none">Tanpa AI Overview</Badge>;
}

function formatDateTimeId(iso: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function KeywordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkId?: string }>;
}) {
  const { id } = await params;
  const { checkId } = await searchParams;

  const { keyword, checks, brandTerms, hasDemoData } =
    await getKeywordDetailData(id);

  if (!keyword) {
    notFound();
  }

  const selectedCheck =
    (checkId ? checks.find((c) => c.id === checkId) : checks[0]) ?? checks[0];

  const highlightedSegments = selectedCheck?.answer_text
    ? splitTextByBrandTerms(selectedCheck.answer_text, brandTerms)
    : [];

  return (
    <div className="space-y-5">
      <DemoDataBanner visible={hasDemoData} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--muted)]">
              {keyword.groupName}
            </span>
            {!keyword.active && <Badge variant="none">Nonaktif</Badge>}
          </div>
          <h2 className="m-0 text-xl font-extrabold">{keyword.text}</h2>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/keyword">Kembali ke daftar keyword</Link>
        </Button>
      </div>

      {!selectedCheck ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum ada riwayat pengecekan</CardTitle>
            <CardDescription>
              Keyword ini belum pernah diperiksa. Jalankan pengecekan dari
              halaman Pengaturan untuk mengambil hasil AI Overview.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="primary">
              <Link href="/pengaturan">Buka halaman Pengaturan</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Teks jawaban AI Overview</CardTitle>
                  <StatusBadge status={selectedCheck.status} />
                </div>
                <CardDescription>
                  Diperiksa pada {formatDateTimeId(selectedCheck.checked_at)} ·
                  Istilah merek yang cocok ditandai warna hijau.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedCheck.status === "no_ai_overview" ||
                !selectedCheck.answer_text ? (
                  <p className="rounded-md bg-[var(--none)] p-4 text-sm text-[var(--muted)]">
                    Google tidak menampilkan teks AI Overview pada pengecekan
                    ini.
                  </p>
                ) : (
                  <div className="whitespace-pre-line rounded-md border border-[var(--line)] bg-[var(--bg)] p-4 text-sm leading-relaxed">
                    {highlightedSegments.map((seg, idx) =>
                      seg.highlighted ? (
                        <mark
                          key={idx}
                          className="rounded bg-[var(--cite-bg)] px-1 py-0.5 font-bold text-[var(--cite)]"
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={idx}>{seg.text}</span>
                      )
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Badge
                    variant={selectedCheck.detected_domain ? "cited" : "none"}
                  >
                    Tingkat 1 (Domain dikutip):{" "}
                    {selectedCheck.detected_domain ? "Ya" : "Tidak"}
                  </Badge>
                  <Badge
                    variant={selectedCheck.detected_text ? "cited" : "none"}
                  >
                    Tingkat 2 (Nama disebut di teks):{" "}
                    {selectedCheck.detected_text ? "Ya" : "Tidak"}
                  </Badge>
                  <Badge
                    variant={
                      selectedCheck.detected_third_party ? "cited" : "none"
                    }
                  >
                    Tingkat 3 (Disebut di sumber lain):{" "}
                    {selectedCheck.detected_third_party ? "Ya" : "Tidak"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  Daftar sumber ({selectedCheck.sources.length})
                </CardTitle>
                <CardDescription>
                  Referensi yang dikutip oleh Google AI Overview.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedCheck.sources.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">
                    Tidak ada sumber referensi pada pengecekan ini.
                  </p>
                ) : (
                  <ul className="space-y-3 p-0 m-0 list-none">
                    {selectedCheck.sources.map((src) => (
                      <li
                        key={src.id}
                        className="rounded-md border border-[var(--line)] p-2.5 text-xs"
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                          <span className="font-bold text-[var(--ink)]">
                            #{src.position + 1} · {src.domain}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {src.is_own && (
                              <Badge variant="cited">Sumber sendiri</Badge>
                            )}
                            {src.is_competitor && (
                              <Badge variant="notDetected">
                                Sumber kompetitor
                              </Badge>
                            )}
                            {!src.is_own && src.mentions_brand && (
                              <Badge variant="cited">Menyebut merek</Badge>
                            )}
                          </div>
                        </div>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 text-[var(--muted)] hover:text-[var(--ink)] hover:underline"
                        >
                          {src.title || src.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Riwayat pengecekan</CardTitle>
              <CardDescription>
                Pilih baris riwayat untuk melihat isi teks jawaban dan sumber
                pada waktu tersebut.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-[var(--line)] p-2 text-left text-xs font-semibold text-[var(--muted)]">
                        Waktu cek
                      </th>
                      <th className="border-b border-[var(--line)] p-2 text-left text-xs font-semibold text-[var(--muted)]">
                        Status
                      </th>
                      <th className="border-b border-[var(--line)] p-2 text-left text-xs font-semibold text-[var(--muted)]">
                        Jenis deteksi
                      </th>
                      <th className="border-b border-[var(--line)] p-2 text-left text-xs font-semibold text-[var(--muted)]">
                        Jumlah sumber
                      </th>
                      <th className="border-b border-[var(--line)] p-2 text-left text-xs font-semibold text-[var(--muted)]">
                        Tindakan
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((chk) => {
                      const isCurrent = chk.id === selectedCheck.id;
                      return (
                        <tr
                          key={chk.id}
                          className={isCurrent ? "bg-[var(--none)]/50" : ""}
                        >
                          <td className="border-b border-[var(--line)] p-2">
                            {formatDateTimeId(chk.checked_at)}
                            {chk.is_demo && (
                              <span className="ml-2 text-[11px] font-semibold text-[var(--seen)]">
                                (Contoh)
                              </span>
                            )}
                          </td>
                          <td className="border-b border-[var(--line)] p-2">
                            <StatusBadge status={chk.status} />
                          </td>
                          <td className="border-b border-[var(--line)] p-2">
                            {formatDetectionTypeLabel(chk)}
                          </td>
                          <td className="border-b border-[var(--line)] p-2">
                            {chk.sources.length} sumber
                          </td>
                          <td className="border-b border-[var(--line)] p-2">
                            <Button asChild variant="outline" size="sm">
                              <Link
                                href={`/keyword/${keyword.id}?checkId=${chk.id}`}
                              >
                                {isCurrent ? "Sedang ditampilkan" : "Lihat detail"}
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
