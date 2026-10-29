import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-[1040px] px-4 pt-6 pb-12">
      <header className="mb-6">
        <h1 className="text-[22px] font-extrabold tracking-tight">
          Pemantau kutipan AI Overview
        </h1>
        <p className="text-sm text-[var(--muted)]">
          linovhr.com · Google Indonesia
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Status Inisialisasi Proyek</CardTitle>
            <Badge variant="cited">Fase 0 Aktif</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted)]">
            Fondasi Next.js App Router, TypeScript strict, Tailwind CSS, dan
            shadcn/ui telah siap. Lanjutkan ke Fase 1 untuk konfigurasi database
            Supabase, RLS, dan autentikasi allowlist.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
