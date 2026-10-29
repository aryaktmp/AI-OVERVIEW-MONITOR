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
        <p className="rounded-md border border-[#C0392B]/30 bg-[#C0392B]/10 px-3 py-2 text-xs text-[#C0392B]">
          {error.message || "Unknown error occurred."}
        </p>
        <Button type="button" variant="primary" onClick={() => reset()}>
          Reload page
        </Button>
      </CardContent>
    </Card>
  );
}
