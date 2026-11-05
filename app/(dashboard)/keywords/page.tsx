import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { getDashboardOverviewData } from "@/lib/dashboard-data";
import { DemoDataBanner } from "@/components/demo-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
    unbatchedActiveKeywordsCount,
    scheduledBatchInfo,
    isScheduledBatchEmpty,
    recentCheckRuns,
  } = await getDashboardOverviewData();

  return (
    <div>
      <DemoDataBanner visible={analytics.hasDemoData} />
      {isScheduledBatchEmpty && scheduledBatchInfo.batch && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="font-medium">
            <strong>Empty scheduled batch warning:</strong> The batch scheduled for this week (
            <strong>{scheduledBatchInfo.batch.name}</strong>) has no active keywords. Scheduled runs will be skipped.
          </AlertDescription>
        </Alert>
      )}
      {unbatchedActiveKeywordsCount > 0 && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="font-medium">
            <strong>Unassigned keywords warning:</strong>{" "}
            {unbatchedActiveKeywordsCount} active{" "}
            {unbatchedActiveKeywordsCount === 1
              ? "keyword has"
              : "keywords have"}{" "}
            no assigned batch and will not be checked.
          </AlertDescription>
        </Alert>
      )}
      <Suspense
        fallback={
          <div className="p-8 text-center text-sm text-[var(--muted)]">
            Loading keyword hub...
          </div>
        }
      >
        <KeywordManagerClient
          rows={analytics.keywordRows}
          groups={groups}
          batches={batches}
          slots={slots}
          scheduleSettings={scheduleSettings}
          monthlyRunCount={monthlyRunCount}
          auditLogs={auditLogs}
          recentCheckRuns={recentCheckRuns}
        />
      </Suspense>
    </div>
  );
}
