"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addBrandTermAction,
  addCompetitorAction,
  clearDemoDataAction,
  deleteBrandTermAction,
  deleteCompetitorAction,
  runCheckNowAction,
  saveSearchSettingsAction,
  toggleBrandTermAction,
} from "@/app/(dashboard)/actions";
import type { RunHistoryRow, SearchSettingsConfig } from "@/lib/dashboard-data";

interface SettingsClientProps {
  brandTerms: Array<{ id: string; term: string; enabled: boolean }>;
  competitors: Array<{ id: string; name: string; domain: string }>;
  searchSettings: SearchSettingsConfig;
  recentRuns: RunHistoryRow[];
  activeKeywordsCount: number;
  estimatedCallsForNextRun: number;
  hourlyCallsUsed: number;
  maxPerHour: number;
  isDryRunEnv: boolean;
  hasDemoData: boolean;
  brandDomain: string;
}

export function SettingsClient({
  brandTerms,
  competitors,
  searchSettings,
  recentRuns,
  activeKeywordsCount,
  estimatedCallsForNextRun,
  hourlyCallsUsed,
  maxPerHour,
  isDryRunEnv,
  hasDemoData,
  brandDomain,
}: SettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [showClearDemoConfirm, setShowClearDemoConfirm] = useState(false);

  const [termInput, setTermInput] = useState("");
  const [compNameInput, setCompNameInput] = useState("");
  const [compDomainInput, setCompDomainInput] = useState("");

  const [locationInput, setLocationInput] = useState(searchSettings.location);
  const [googleDomainInput, setGoogleDomainInput] = useState(
    searchSettings.google_domain
  );
  const [glInput, setGlInput] = useState(searchSettings.gl);
  const [hlInput, setHlInput] = useState(searchSettings.hl);
  const [thirdPartyEnabled, setThirdPartyEnabled] = useState(
    searchSettings.enable_third_party_check
  );

  const remainingHourlyQuota = Math.max(0, maxPerHour - hourlyCallsUsed);

  function handleRunCheckConfirm() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await runCheckNowAction();
        setShowRunConfirm(false);
        setFeedback({
          ok: true,
          message: `Pengecekan selesai diproses (${res.succeededCount}/${res.processedCount} item berhasil, ${res.serpApiCallsUsed} panggilan SerpApi dipakai).`,
        });
      } catch (err) {
        setShowRunConfirm(false);
        setFeedback({
          ok: false,
          message:
            err instanceof Error
              ? err.message
              : "Gagal menjalankan pengecekan sekarang.",
        });
      }
    });
  }

  function handleClearDemoConfirm() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await clearDemoDataAction();
        setShowClearDemoConfirm(false);
        setFeedback(res);
      } catch (err) {
        setShowClearDemoConfirm(false);
        setFeedback({
          ok: false,
          message:
            err instanceof Error ? err.message : "Gagal menghapus data contoh.",
        });
      }
    });
  }

  function handleAddBrandTerm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("term", termInput);

    startTransition(async () => {
      const res = await addBrandTermAction(fd);
      setFeedback(res);
      if (res.ok) setTermInput("");
    });
  }

  function handleToggleBrandTerm(id: string, nextEnabled: boolean) {
    setFeedback(null);
    startTransition(async () => {
      const res = await toggleBrandTermAction(id, nextEnabled);
      if (!res.ok && res.message) {
        setFeedback({ ok: false, message: res.message });
      }
    });
  }

  function handleDeleteBrandTerm(id: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteBrandTermAction(id);
      if (!res.ok && res.message) {
        setFeedback({ ok: false, message: res.message });
      }
    });
  }

  function handleAddCompetitor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("name", compNameInput);
    fd.set("domain", compDomainInput);

    startTransition(async () => {
      const res = await addCompetitorAction(fd);
      setFeedback(res);
      if (res.ok) {
        setCompNameInput("");
        setCompDomainInput("");
      }
    });
  }

  function handleDeleteCompetitor(id: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteCompetitorAction(id);
      if (!res.ok && res.message) {
        setFeedback({ ok: false, message: res.message });
      }
    });
  }

  function handleSaveSearchSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("location", locationInput);
    fd.set("google_domain", googleDomainInput);
    fd.set("gl", glInput);
    fd.set("hl", hlInput);
    fd.set("enable_third_party_check", thirdPartyEnabled ? "true" : "false");

    startTransition(async () => {
      const res = await saveSearchSettingsAction(fd);
      setFeedback(res);
    });
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-[13px] ${
            feedback.ok
              ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]"
              : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Dialog Konfirmasi: Jalankan Cek Sekarang */}
      {showRunConfirm && (
        <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-4">
          <h3 className="text-[14px] font-semibold text-[#1E3A8A]">
            Konfirmasi Jalankan Pengecekan Sekarang
          </h3>
          <p className="mt-1 text-[13px] text-[#1E40AF]">
            Anda akan memulai antrean pengecekan untuk{" "}
            <strong>{activeKeywordsCount} keyword aktif</strong>.
          </p>
          <ul className="mt-2 space-y-1 text-[12.5px] text-[#1E3A8A]">
            <li>
              • Perkiraan panggilan SerpApi:{" "}
              <strong className="font-mono">
                ~{estimatedCallsForNextRun} panggilan
              </strong>{" "}
              (1–2 panggilan per keyword)
            </li>
            <li>
              • Sisa batas per jam saat ini:{" "}
              <strong className="font-mono">
                {remainingHourlyQuota} dari {maxPerHour} panggilan/jam
              </strong>{" "}
              ({hourlyCallsUsed} terpakai dalam 60 menit terakhir)
            </li>
            <li>
              • Mode saat ini:{" "}
              <strong>
                {isDryRunEnv
                  ? "Simulasi / Dry Run (SERPAPI_DRY_RUN=true — tidak memotong kuota nyata)"
                  : "Pencarian Nyata SerpApi (memotong kuota paket SerpApi)"}
              </strong>
            </li>
          </ul>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={isPending || activeKeywordsCount === 0}
              onClick={handleRunCheckConfirm}
            >
              {isPending ? "Memproses antrean..." : "Ya, jalankan cek sekarang"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => setShowRunConfirm(false)}
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* Dialog Konfirmasi: Hapus Data Contoh */}
      {showClearDemoConfirm && (
        <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4">
          <h3 className="text-[14px] font-semibold text-[#92400E]">
            Konfirmasi Hapus Data Contoh
          </h3>
          <p className="mt-1 text-[13px] text-[#B45309]">
            Semua riwayat pengecekan dari run simulasi (<code>is_demo = true</code>)
            akan dihapus permanen. Data pengecekan nyata dan daftar keyword tidak
            akan terhapus.
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={isPending}
              onClick={handleClearDemoConfirm}
            >
              {isPending ? "Menghapus..." : "Ya, hapus data contoh"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => setShowClearDemoConfirm(false)}
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* Panel Kontrol Eksekusi Manual & Kuota */}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">
              Eksekusi Pengecekan &amp; Data Contoh
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">
              Jadwal otomatis berjalan setiap Senin pukul 07:00 WIB. Anda juga
              dapat memicu pengecekan manual kapan saja.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasDemoData && (
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => {
                  setShowRunConfirm(false);
                  setShowClearDemoConfirm(true);
                }}
              >
                Hapus data contoh
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              disabled={isPending}
              onClick={() => {
                setShowClearDemoConfirm(false);
                setShowRunConfirm(true);
              }}
            >
              Jalankan cek sekarang
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-[var(--line)] pt-3 text-[12.5px] sm:grid-cols-3">
          <div>
            <span className="text-[var(--muted)]">Keyword aktif: </span>
            <strong className="font-mono text-[var(--ink)]">
              {activeKeywordsCount} keyword
            </strong>
          </div>
          <div>
            <span className="text-[var(--muted)]">Pemakaian 60 menit terakhir: </span>
            <strong className="font-mono text-[var(--ink)]">
              {hourlyCallsUsed} / {maxPerHour} panggilan
            </strong>
          </div>
          <div>
            <span className="text-[var(--muted)]">Mode SerpApi: </span>
            <Badge variant={isDryRunEnv ? "notDetected" : "detected"}>
              {isDryRunEnv ? "Dry Run (Contoh)" : "Produksi (Nyata)"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Dua Kolom Pengaturan Merek & Lokasi seperti di dashboard-ai-overview.html */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {/* Identitas Merek */}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <h2 className="mb-3 text-[14px] font-semibold text-[var(--ink)]">
            Identitas Merek
          </h2>

          <div className="mb-3 text-[13px]">
            <div className="text-[var(--muted)]">Domain utama</div>
            <div className="mt-0.5 font-mono font-medium text-[var(--ink)]">
              {brandDomain}
            </div>
          </div>

          <div className="mb-3 text-[13px]">
            <div className="mb-1.5 text-[var(--muted)]">
              Variasi nama merek di teks jawaban
            </div>
            {brandTerms.length === 0 ? (
              <p className="text-[12.5px] text-[var(--muted)]">
                Belum ada istilah merek terdaftar.
              </p>
            ) : (
              <div className="space-y-1.5">
                {brandTerms.map((bt) => (
                  <div
                    key={bt.id}
                    className="flex items-center justify-between rounded border border-[var(--line)] bg-[#F8FAFC] px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] font-medium text-[var(--ink)]">
                        {bt.term}
                      </span>
                      <Badge variant={bt.enabled ? "detected" : "none"}>
                        {bt.enabled ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          handleToggleBrandTerm(bt.id, !bt.enabled)
                        }
                        className="text-[11.5px] font-medium text-[var(--muted)] hover:text-[var(--ink)]"
                      >
                        {bt.enabled ? "Matikan" : "Aktifkan"}
                      </button>
                      <span className="text-[var(--line)]">|</span>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleDeleteBrandTerm(bt.id)}
                        className="text-[11.5px] font-medium text-[#DC2626] hover:underline"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleAddBrandTerm} className="flex gap-2">
            <input
              type="text"
              value={termInput}
              onChange={(e) => setTermInput(e.target.value)}
              placeholder="Tambah istilah (mis. LinovHR)"
              className="flex-1 rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 text-[13px]"
              required
            />
            <Button type="submit" size="sm" disabled={isPending}>
              Tambah istilah
            </Button>
          </form>
        </div>

        {/* Parameter Pencarian (Tabel settings) */}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <h2 className="mb-3 text-[14px] font-semibold text-[var(--ink)]">
            Parameter Pencarian
          </h2>

          <form onSubmit={handleSaveSearchSettings} className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-[12px] text-[var(--muted)]">
                  Lokasi pencarian
                </label>
                <input
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  className="w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 text-[13px]"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] text-[var(--muted)]">
                  Domain Google
                </label>
                <input
                  type="text"
                  value={googleDomainInput}
                  onChange={(e) => setGoogleDomainInput(e.target.value)}
                  className="w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 font-mono text-[13px]"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-[12px] text-[var(--muted)]">
                  Kode negara (gl)
                </label>
                <input
                  type="text"
                  maxLength={2}
                  value={glInput}
                  onChange={(e) => setGlInput(e.target.value)}
                  className="w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 font-mono text-[13px]"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] text-[var(--muted)]">
                  Kode bahasa (hl)
                </label>
                <input
                  type="text"
                  value={hlInput}
                  onChange={(e) => setHlInput(e.target.value)}
                  className="w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 font-mono text-[13px]"
                  required
                />
              </div>
            </div>

            <label className="flex items-center gap-2 pt-1 text-[12.5px] text-[var(--ink)]">
              <input
                type="checkbox"
                checked={thirdPartyEnabled}
                onChange={(e) => setThirdPartyEnabled(e.target.checked)}
                className="rounded border-[var(--line)]"
              />
              Aktifkan pemeriksaan halaman sumber pihak ketiga (Tingkat 3)
            </label>

            <div className="pt-1">
              <Button type="submit" size="sm" disabled={isPending}>
                Simpan pengaturan
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Daftar Kompetitor */}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--ink)]">
          Daftar Kompetitor
        </h2>
        <p className="mb-3 text-[12.5px] text-[var(--muted)]">
          Domain kompetitor akan ditandai secara otomatis pada daftar sumber AI
          Overview dan halaman Kompetitor.
        </p>

        <form
          onSubmit={handleAddCompetitor}
          className="mb-3.5 flex flex-wrap gap-2"
        >
          <input
            type="text"
            value={compNameInput}
            onChange={(e) => setCompNameInput(e.target.value)}
            placeholder="Nama kompetitor (mis. Mekari Talenta)"
            className="min-w-[200px] flex-1 rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 text-[13px]"
            required
          />
          <input
            type="text"
            value={compDomainInput}
            onChange={(e) => setCompDomainInput(e.target.value)}
            placeholder="Domain (mis. talenta.co)"
            className="min-w-[180px] flex-1 rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 font-mono text-[13px]"
            required
          />
          <Button type="submit" size="sm" disabled={isPending}>
            Simpan kompetitor
          </Button>
        </form>

        {competitors.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            Belum ada kompetitor yang ditambahkan.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {competitors.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded border border-[var(--line)] bg-[#F8FAFC] px-3 py-2 text-[13px]"
              >
                <div className="truncate">
                  <div className="font-medium text-[var(--ink)]">{c.name}</div>
                  <div className="font-mono text-[11.5px] text-[var(--muted)]">
                    {c.domain}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDeleteCompetitor(c.id)}
                  className="ml-2 text-[12px] font-medium text-[#DC2626] hover:underline"
                >
                  Hapus
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Riwayat Run & Jumlah Panggilan SerpApi per Run */}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">
              Riwayat Run &amp; Pemakaian Panggilan SerpApi
            </h2>
            <p className="text-[12px] text-[var(--muted)]">
              Menampilkan jumlah panggilan SerpApi per run (termasuk panggilan
              kedua untuk page_token).
            </p>
          </div>
        </div>

        {recentRuns.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[var(--muted)]">
            Belum ada riwayat pengecekan. Klik &ldquo;Jalankan cek sekarang&rdquo; di
            atas untuk memulai.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]">
                  <th className="py-2 pr-3">Waktu Mulai</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Jenis Run</th>
                  <th className="px-3 py-2">Keyword Selesai</th>
                  <th className="py-2 pl-3 text-right">Panggilan SerpApi</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-[var(--line)] last:border-b-0"
                  >
                    <td className="py-2.5 pr-3 font-mono text-[12px] text-[var(--ink)]">
                      {new Date(run.started_at).toLocaleString("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant={
                          run.status === "done"
                            ? "detected"
                            : run.status === "running"
                              ? "notDetected"
                              : "none"
                        }
                      >
                        {run.status === "done"
                          ? "Selesai"
                          : run.status === "running"
                            ? "Berjalan"
                            : run.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={run.is_demo ? "notDetected" : "brand"}>
                        {run.is_demo ? "Data Contoh" : "Pencarian Nyata"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--muted)]">
                      {run.done} / {run.total}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono text-[12.5px] font-semibold text-[var(--ink)]">
                      {run.serpapi_calls} panggilan
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
