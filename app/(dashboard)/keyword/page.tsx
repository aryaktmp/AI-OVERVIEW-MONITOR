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
      <KeywordManagerClient
        rows={analytics.keywordRows}
        groups={groups}
        batches={batches}
        slots={slots}
        scheduleSettings={scheduleSettings}
        monthlyRunCount={monthlyRunCount}
        auditLogs={auditLogs}
      />
    </div>
  );
}
