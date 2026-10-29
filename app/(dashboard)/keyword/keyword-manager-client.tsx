"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { HeatmapCellState, KeywordWeeklyRow } from "@/lib/analytics";
import {
  CSV_TEMPLATE_CONTENT,
  MAX_CSV_IMPORT_ROWS,
  parseKeywordCsvPreview,
} from "@/lib/csv-import";
import {
  addKeywordAction,
  addKeywordGroupAction,
  deleteKeywordAction,
  deleteKeywordGroupAction,
  importKeywordsCsvAction,
  toggleKeywordActiveAction,
} from "@/app/(dashboard)/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const STATUS_LABELS: Record<HeatmapCellState, string> = {
  0: "Tanpa AI Overview",
  1: "Tidak terdeteksi",
  2: "Terdeteksi",
};

function miniCellClass(state: HeatmapCellState): string {
  if (state === 2) {
    return "h-4 w-3 rounded-[3px] bg-[var(--cite)]";
  }
  if (state === 1) {
    return "h-4 w-3 rounded-[3px] bg-[var(--seen-bg)] inset-ring inset-ring-[var(--seen)]";
  }
  return "h-4 w-3 rounded-[3px] bg-[var(--none)]";
}

const columnHelper = createColumnHelper<KeywordWeeklyRow>();

export function KeywordManagerClient({
  rows,
  groups,
}: {
  rows: KeywordWeeklyRow[];
  groups: Array<{ id: string; name: string }>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [showCsvPanel, setShowCsvPanel] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const existingKeywords = useMemo(
    () => rows.map((r) => r.keyword),
    [rows]
  );
  const existingGroupNames = useMemo(
    () => groups.map((g) => g.name),
    [groups]
  );

  const csvPreview = useMemo(() => {
    if (!csvText.trim()) return null;
    return parseKeywordCsvPreview(
      csvText,
      existingKeywords,
      existingGroupNames
    );
  }, [csvText, existingKeywords, existingGroupNames]);

  function handleDownloadCsvTemplate() {
    const blob = new Blob([CSV_TEMPLATE_CONTENT], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "template-keyword-linovhr.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsText(file, "utf-8");
  }

  function handleConfirmCsvImport() {
    if (!csvPreview || csvPreview.validRows.length === 0) return;
    setFeedback(null);
    const fd = new FormData();
    fd.set("csvText", csvText);

    startTransition(async () => {
      const res = await importKeywordsCsvAction(fd);
      setFeedback({
        type: res.ok ? "success" : "error",
        text: res.message,
      });
      if (res.ok) {
        setCsvText("");
        setCsvFileName("");
        setShowCsvPanel(false);
      }
    });
  }

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.keyword.toLowerCase().includes(q)) return false;
      if (selectedGroup && r.groupName !== selectedGroup) return false;
      if (
        selectedStatus !== "" &&
        String(r.currentState) !== selectedStatus
      ) {
        return false;
      }
      return true;
    });
  }, [rows, searchQuery, selectedGroup, selectedStatus]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("keyword", {
        header: "Keyword",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-2">
              <Link
                href={`/keyword/${row.id}`}
                className="font-semibold text-[var(--ink)] hover:underline"
              >
                {row.keyword}
              </Link>
              {!row.active && <Badge variant="none">Nonaktif</Badge>}
            </div>
          );
        },
      }),
      columnHelper.accessor("groupName", {
        header: "Grup",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("currentState", {
        header: "Minggu ini",
        cell: (info) => {
          const st = info.getValue();
          const variant =
            st === 2 ? "cited" : st === 1 ? "notDetected" : "none";
          return <Badge variant={variant}>{STATUS_LABELS[st]}</Badge>;
        },
      }),
      columnHelper.accessor("detectionTypeLabel", {
        header: "Jenis deteksi",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("weeklyStates", {
        header: "8 minggu",
        cell: (info) => (
          <div className="flex gap-[2px]">
            {info.getValue().map((st, idx) => (
              <div key={idx} className={miniCellClass(st)} />
            ))}
          </div>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "Tindakan",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    const res = await toggleKeywordActiveAction(
                      row.id,
                      !row.active
                    );
                    if (!res.ok) {
                      setFeedback({
                        type: "error",
                        text: res.message ?? "Gagal mengubah status keyword.",
                      });
                    }
                  });
                }}
              >
                {row.active ? "Nonaktifkan keyword" : "Aktifkan keyword"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    const res = await deleteKeywordAction(row.id);
                    if (!res.ok) {
                      setFeedback({
                        type: "error",
                        text: res.message ?? "Gagal menghapus keyword.",
                      });
                    }
                  });
                }}
              >
                Hapus keyword
              </Button>
            </div>
          );
        },
      }),
    ],
    [isPending]
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const allGroupNames = useMemo(() => {
    const names = new Set<string>(groups.map((g) => g.name));
    for (const r of rows) {
      if (r.groupName) names.add(r.groupName);
    }
    return Array.from(names).sort();
  }, [groups, rows]);

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          role="alert"
          className={`rounded-md border px-3 py-2 text-xs font-medium ${
            feedback.type === "success"
              ? "border-[var(--cite)]/30 bg-[var(--cite-bg)] text-[var(--cite)]"
              : "border-[#C0392B]/30 bg-[#C0392B]/10 text-[#C0392B]"
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Tambah keyword baru</CardTitle>
                <CardDescription>
                  Masukkan keyword satuan atau impor daftar keyword lewat CSV.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCsvTemplate}
                >
                  Unduh template CSV
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowCsvPanel((prev) => !prev)}
                >
                  {showCsvPanel ? "Tutup impor CSV" : "Impor CSV"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              action={(formData) => {
                startTransition(async () => {
                  const res = await addKeywordAction(formData);
                  setFeedback({
                    type: res.ok ? "success" : "error",
                    text: res.message,
                  });
                });
              }}
              className="flex flex-wrap items-end gap-2.5"
            >
              <div className="min-w-[200px] flex-1 space-y-1">
                <label htmlFor="kw-text" className="block text-xs font-semibold">
                  Keyword
                </label>
                <Input
                  id="kw-text"
                  name="text"
                  placeholder="Contoh: software payroll terbaik"
                  required
                  disabled={isPending}
                />
              </div>

              <div className="min-w-[160px] space-y-1">
                <label
                  htmlFor="kw-group"
                  className="block text-xs font-semibold"
                >
                  Pilih grup
                </label>
                <select
                  id="kw-group"
                  name="groupId"
                  disabled={isPending}
                  className="flex h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--ink)]"
                >
                  <option value="">Tanpa grup</option>
                  {groups.map((grp) => (
                    <option key={grp.id} value={grp.id}>
                      {grp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[160px] space-y-1">
                <label
                  htmlFor="kw-new-group"
                  className="block text-xs font-semibold"
                >
                  Atau buat grup baru
                </label>
                <Input
                  id="kw-new-group"
                  name="newGroupName"
                  placeholder="Nama grup baru"
                  disabled={isPending}
                />
              </div>

              <Button type="submit" variant="primary" disabled={isPending}>
                Simpan keyword
              </Button>
            </form>

            {showCsvPanel && (
              <div className="rounded-lg border border-[var(--line)] bg-[#F8FAFC] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--ink)]">
                      Impor Keyword dari CSV (maksimal {MAX_CSV_IMPORT_ROWS} baris)
                    </h3>
                    <p className="text-xs text-[var(--muted)]">
                      Format kolom: <code>keyword,group</code>. Grup yang belum ada
                      akan dibuat secara otomatis.
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--none)]">
                    Pilih file .csv
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleCsvFileChange}
                      className="hidden"
                    />
                  </label>
                </div>

                {csvFileName && (
                  <p className="text-xs text-[var(--muted)]">
                    File dipilih: <strong className="font-mono">{csvFileName}</strong>
                  </p>
                )}

                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={4}
                  placeholder={CSV_TEMPLATE_CONTENT}
                  className="w-full rounded-md border border-[var(--line)] bg-white p-2.5 font-mono text-xs text-[var(--ink)]"
                />

                {csvPreview && (
                  <div className="space-y-2.5 rounded-md border border-[var(--line)] bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-[var(--ink)]">
                        Pratinjau Impor:
                      </span>
                      <Badge variant="detected">
                        {csvPreview.validRows.length} baru
                      </Badge>
                      <Badge variant="notDetected">
                        {csvPreview.duplicateRows.length} duplikat
                      </Badge>
                      <Badge variant="none">
                        {csvPreview.invalidRows.length} tidak valid
                      </Badge>
                      {csvPreview.newGroupsToCreate.length > 0 && (
                        <Badge variant="brand">
                          {csvPreview.newGroupsToCreate.length} grup baru:{" "}
                          {csvPreview.newGroupsToCreate.join(", ")}
                        </Badge>
                      )}
                    </div>

                    {csvPreview.exceededMaxRows && (
                      <p className="text-xs font-medium text-[#C0392B]">
                        Jumlah baris melebihi batas maksimal {MAX_CSV_IMPORT_ROWS}{" "}
                        baris per impor. Kurangi jumlah baris sebelum menyimpan.
                      </p>
                    )}

                    {csvPreview.duplicateRows.length > 0 && (
                      <div className="max-h-28 overflow-y-auto rounded border border-[var(--line)] bg-[#FFFBEB] p-2 text-xs">
                        <div className="mb-1 font-semibold text-[#92400E]">
                          Baris Duplikat ({csvPreview.duplicateRows.length} dilewati):
                        </div>
                        <ul className="space-y-0.5 text-[#B45309]">
                          {csvPreview.duplicateRows.slice(0, 15).map((d) => (
                            <li key={`${d.lineNumber}-${d.keyword}`}>
                              Baris {d.lineNumber}:{" "}
                              <strong className="font-mono">{d.keyword}</strong> —{" "}
                              {d.reason}
                            </li>
                          ))}
                          {csvPreview.duplicateRows.length > 15 && (
                            <li>
                              ...dan {csvPreview.duplicateRows.length - 15} baris
                              duplikat lainnya.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {csvPreview.invalidRows.length > 0 && (
                      <div className="max-h-28 overflow-y-auto rounded border border-[#FECACA] bg-[#FEF2F2] p-2 text-xs">
                        <div className="mb-1 font-semibold text-[#991B1B]">
                          Baris Tidak Valid ({csvPreview.invalidRows.length}):
                        </div>
                        <ul className="space-y-0.5 text-[#B91C1C]">
                          {csvPreview.invalidRows.slice(0, 15).map((inv, i) => (
                            <li key={`${inv.lineNumber}-${i}`}>
                              Baris {inv.lineNumber}:{" "}
                              <strong className="font-mono">
                                {inv.rawKeyword || "(kosong)"}
                              </strong>{" "}
                              — {inv.reason}
                            </li>
                          ))}
                          {csvPreview.invalidRows.length > 15 && (
                            <li>
                              ...dan {csvPreview.invalidRows.length - 15} baris tidak
                              valid lainnya.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={
                          isPending ||
                          csvPreview.validRows.length === 0 ||
                          csvPreview.exceededMaxRows
                        }
                        onClick={handleConfirmCsvImport}
                      >
                        {isPending
                          ? "Menyimpan..."
                          : `Simpan ${csvPreview.validRows.length} keyword baru`}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => {
                          setCsvText("");
                          setCsvFileName("");
                        }}
                      >
                        Bersihkan pratinjau
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kelola grup keyword</CardTitle>
            <CardDescription>
              Kelompokkan keyword berdasarkan topik.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              action={(formData) => {
                startTransition(async () => {
                  const res = await addKeywordGroupAction(formData);
                  setFeedback({
                    type: res.ok ? "success" : "error",
                    text: res.message,
                  });
                });
              }}
              className="flex gap-2"
            >
              <Input
                name="name"
                placeholder="Nama grup baru"
                required
                disabled={isPending}
              />
              <Button type="submit" variant="outline" disabled={isPending}>
                Simpan grup
              </Button>
            </form>

            {groups.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                Belum ada grup yang dibuat.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {groups.map((grp) => (
                  <span
                    key={grp.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--none)] px-2.5 py-1 text-xs font-medium"
                  >
                    {grp.name}
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          await deleteKeywordGroupAction(grp.id);
                        });
                      }}
                      className="ml-0.5 text-[#C0392B] hover:underline cursor-pointer"
                      aria-label={`Hapus grup ${grp.name}`}
                    >
                      Hapus
                    </button>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari keyword"
              aria-label="Cari keyword"
              className="min-w-[160px] flex-1"
            />
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              aria-label="Filter grup"
              className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm text-[var(--ink)]"
            >
              <option value="">Semua grup</option>
              {allGroupNames.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              aria-label="Filter status"
              className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm text-[var(--ink)]"
            >
              <option value="">Semua status</option>
              <option value="2">Terdeteksi</option>
              <option value="1">Tidak terdeteksi</option>
              <option value="0">Tanpa AI Overview</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="border-b border-[var(--line)] p-2 text-left text-xs font-semibold text-[var(--muted)]"
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="border-b border-[var(--line)] py-6 text-center text-sm text-[var(--muted)]"
                    >
                      {rows.length === 0
                        ? "Belum ada keyword yang tersimpan. Gunakan formulir di atas untuk menyimpan keyword pertama Anda."
                        : "Tidak ada keyword yang cocok. Ubah kata kunci atau filter."}
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="border-b border-[var(--line)] px-2 py-2.5 align-middle"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
