import { Suspense } from "react";
import { getDashboardOverviewData } from "@/lib/dashboard-data";
import { DemoDataBanner } from "@/components/demo-banner";
import { KeywordManagerClient } from "./keyword-manager-client";

export const dynamic = "force-dynamic";

export default async function KeywordPage() {
  const {
    analytics,
    groups,
    batches,
    slots,
    scheduleSettings,
    monthlyRunCount,
    auditLogs,
  } = await getDashboardOverviewData();

  return (
    <div>
      <DemoDataBanner visible={analytics.hasDemoData} />
      <Suspense fallback={<div className="p-8 text-center text-sm text-[var(--muted)]">Loading keyword hub...</div>}>
        <KeywordManagerClient
          rows={analytics.keywordRows}
          groups={groups}
          batches={batches}
          slots={slots}
          scheduleSettings={scheduleSettings}
          monthlyRunCount={monthlyRunCount}
          auditLogs={auditLogs}
        />
      </Suspense>
    </div>
  );
}
