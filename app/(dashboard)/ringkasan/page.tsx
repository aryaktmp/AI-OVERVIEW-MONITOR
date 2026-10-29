import Link from "next/link";
import { getDashboardOverviewData } from "@/lib/dashboard-data";
import { DemoDataBanner } from "@/components/demo-banner";
import { WeeklyTrendChart } from "@/components/weekly-trend-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { HeatmapCellState, KeywordWeeklyRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function DeltaBadge({
  delta,
  suffix = "",
}: {
  delta: number;
  suffix?: string;
}) {
  const isPositive = delta >= 0;
  return (
    <i
      className={`ml-1.5 text-xs font-semibold not-italic ${
        isPositive ? "text-[var(--cite)]" : "text-[#C0392B]"
      }`}
    >
      {isPositive ? "+" : ""}
      {delta}
      {suffix} vs minggu lalu
    </i>
  );
}

function cellClassName(state: HeatmapCellState): string {
  if (state === 2) {
    return "h-[22px] rounded-[3px] bg-[var(--cite)]";
  }
  if (state === 1) {
    return "h-[22px] rounded-[3px] bg-[var(--seen-bg)] inset-ring inset-ring-[var(--seen)]";
  }
  return "h-[22px] rounded-[3px] bg-[var(--none)]";
}

export default async function RingkasanPage() {
  const { analytics } = await getDashboardOverviewData();

  if (analytics.totalKeywords === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Belum ada keyword yang dipantau</CardTitle>
          <CardDescription>
            Tambahkan keyword terlebih dahulu untuk mulai memantau kutipan LinovHR
            di Google AI Overview.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <Link href="/keyword">Tambah keyword pertama</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/pengaturan">Buka pengaturan</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Kelompokkan baris keyword berdasarkan grup sesuai prototipe
  const sortedRows = [...analytics.keywordRows].sort((a, b) => {
    const grpCmp = a.groupName.localeCompare(b.groupName);
    if (grpCmp !== 0) return grpCmp;
    return a.keyword.localeCompare(b.keyword);
  });

  const rowsByGroup = new Map<string, KeywordWeeklyRow[]>();
  for (const row of sortedRows) {
    const list = rowsByGroup.get(row.groupName) ?? [];
    list.push(row);
    rowsByGroup.set(row.groupName, list);
  }

  return (
    <div>
      <DemoDataBanner visible={analytics.hasDemoData} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
          <b className="block text-[28px] leading-[1.1] font-extrabold">
            {analytics.activeKeywords}
          </b>
          <span className="text-[13px] text-[var(--muted)]">
            Keyword dipantau
          </span>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
          <b className="block text-[28px] leading-[1.1] font-extrabold">
            {analytics.currentAiOverviewCount}
          </b>
          <span className="text-[13px] text-[var(--muted)]">
            AI Overview muncul
          </span>
          <DeltaBadge delta={analytics.aiOverviewDelta} />
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
          <b className="block text-[28px] leading-[1.1] font-extrabold">
            {analytics.currentDetectedCount}
          </b>
          <span className="text-[13px] text-[var(--muted)]">
            LinovHR terdeteksi
          </span>
          <DeltaBadge delta={analytics.detectedDelta} />
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
          <b className="block text-[28px] leading-[1.1] font-extrabold">
            {analytics.currentDetectionRate}%
          </b>
          <span className="text-[13px] text-[var(--muted)]">
            Tingkat deteksi
          </span>
          <DeltaBadge delta={analytics.detectionRateDelta} suffix=" poin" />
        </div>
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Tingkat deteksi per minggu</CardTitle>
          <CardDescription>
            Keyword yang menampilkan LinovHR, dibanding keyword yang memunculkan
            AI Overview.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WeeklyTrendChart weeks={analytics.weeks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status tiap keyword, 8 minggu terakhir</CardTitle>
          <CardDescription>
            Tiap kolom adalah satu minggu. Kolom paling kanan adalah minggu ini.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="grid min-w-[520px] grid-cols-[minmax(190px,1.6fr)_repeat(8,minmax(34px,1fr))] items-center gap-[3px]">
              <div />
              {analytics.weeks.map((w) => {
                const [day, month] = w.label.split(" ");
                return (
                  <div
                    key={w.index}
                    className="text-center text-[11px] leading-tight text-[var(--muted)]"
                  >
                    {day}
                    <br />
                    {month}
                  </div>
                );
              })}

              {Array.from(rowsByGroup.entries()).map(([groupName, rows]) => (
                <div key={groupName} className="contents">
                  <div className="col-span-full mt-2.5 text-[13px] font-extrabold">
                    {groupName}
                  </div>
                  {rows.map((row) => (
                    <div key={row.id} className="contents">
                      <Link
                        href={`/keyword/${row.id}`}
                        title={row.keyword}
                        className="truncate text-[13px] hover:underline"
                      >
                        {row.keyword}
                      </Link>
                      {row.weeklyStates.map((st, idx) => (
                        <div
                          key={idx}
                          className={cellClassName(st)}
                          title={`${row.keyword} (${analytics.weeks[idx]?.label}): ${
                            st === 2
                              ? "LinovHR terdeteksi"
                              : st === 1
                                ? "AI Overview muncul, LinovHR tidak terdeteksi"
                                : "AI Overview tidak muncul"
                          }`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3.5 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-[3px] bg-[var(--cite)]" />
              LinovHR terdeteksi
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-[3px] bg-[var(--seen-bg)] inset-ring inset-ring-[var(--seen)]" />
              AI Overview muncul, LinovHR tidak terdeteksi
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-[3px] bg-[var(--none)]" />
              AI Overview tidak muncul
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
