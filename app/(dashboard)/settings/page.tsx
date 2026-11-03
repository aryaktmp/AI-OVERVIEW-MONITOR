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
          Monitoring Settings
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          Brand identity search terms, competitor list, search parameters,
          database storage, and SerpApi quota.
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
