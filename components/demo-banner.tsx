import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function DemoDataBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <Alert variant="warning" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <div className="flex flex-wrap items-center justify-between gap-2 w-full">
        <AlertDescription className="font-medium">
          <strong>Demo data:</strong> This page displays results from simulation / sample checks (dry-run).
        </AlertDescription>
        <Link
          href="/pengaturan"
          className="text-xs font-bold underline hover:opacity-80"
        >
          Manage or clear demo data in Settings →
        </Link>
      </div>
    </Alert>
  );
}
