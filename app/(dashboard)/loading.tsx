import { Card, CardContent } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((idx) => (
          <div
            key={idx}
            className="h-[84px] animate-pulse rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
          />
        ))}
      </div>
      <Card>
        <CardContent className="py-12 text-center text-sm text-[var(--muted)]">
          Loading data from server...
        </CardContent>
      </Card>
    </div>
  );
}
