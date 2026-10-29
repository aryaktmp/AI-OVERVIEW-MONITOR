import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function RingkasanPage() {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Ringkasan Pemantauan</CardTitle>
            <Badge variant="cited">Sesi Terverifikasi</Badge>
          </div>
          <CardDescription>
            Anda masuk sebagai pengguna yang diizinkan di ALLOWED_EMAILS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted)]">
            Kartu statistik, grafik tren 8 minggu, dan peta status keyword akan
            ditampilkan pada Fase 4 setelah klien SerpApi (Fase 2) dan antrean
            pengecekan (Fase 3) selesai dibangun.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
