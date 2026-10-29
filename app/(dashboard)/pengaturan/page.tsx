import { getSettingsPageData } from "@/lib/dashboard-data";
import { DemoDataBanner } from "@/components/demo-banner";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function PengaturanPage() {
  const data = await getSettingsPageData();
  const brandDomain = process.env.BRAND_DOMAIN ?? "linovhr.com";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
          Pengaturan Pemantauan
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          Identitas merek yang dicari, daftar kompetitor, lokasi pencarian,
          penyimpanan database, dan kuota panggilan SerpApi.
        </p>
      </div>

      <DemoDataBanner visible={data.hasDemoData} />

      <SettingsClient
        brandTerms={data.brandTerms}
        competitors={data.competitors}
        searchSettings={data.searchSettings}
        recentRuns={data.recentRuns}
        activeKeywordsCount={data.activeKeywordsCount}
        estimatedCallsForNextRun={data.estimatedCallsForNextRun}
        hourlyCallsUsed={data.hourlyCallsUsed}
        maxPerHour={data.maxPerHour}
        isDryRunEnv={data.isDryRunEnv}
        hasDemoData={data.hasDemoData}
        brandDomain={brandDomain}
        databaseStorage={data.databaseStorage}
        initialRunningRun={data.runningRun}
      />
    </div>
  );
}
