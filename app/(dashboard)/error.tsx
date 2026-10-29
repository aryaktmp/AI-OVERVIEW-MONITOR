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
        <CardTitle>Gagal memuat halaman</CardTitle>
        <CardDescription>
          Terjadi kendala saat mengambil data dari database.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-md border border-[#C0392B]/30 bg-[#C0392B]/10 px-3 py-2 text-xs text-[#C0392B]">
          {error.message || "Galat tidak diketahui."}
        </p>
        <Button type="button" variant="primary" onClick={() => reset()}>
          Muat ulang halaman
        </Button>
      </CardContent>
    </Card>
  );
}
