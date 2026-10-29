import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <h1 className="text-[22px] font-extrabold tracking-tight">
          Pemantau kutipan AI Overview
        </h1>
        <p className="text-sm text-[var(--muted)]">
          linovhr.com · Google Indonesia
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Masuk ke akun Anda</CardTitle>
          <CardDescription>
            Hanya email yang terdaftar di daftar izin yang dapat masuk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm initialError={params.error} />
        </CardContent>
      </Card>
    </main>
  );
}
