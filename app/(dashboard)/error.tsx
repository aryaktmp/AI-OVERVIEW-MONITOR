"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Failed to load page</CardTitle>
        <CardDescription>
          An error occurred while retrieving data from the database.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-bg)] px-3 py-2 text-xs font-medium text-[var(--destructive-text)]">
          {error.message || "Unknown error occurred."}
        </p>
        <Button type="button" variant="primary" onClick={() => reset()}>
          Reload page
        </Button>
      </CardContent>
    </Card>
  );
}
