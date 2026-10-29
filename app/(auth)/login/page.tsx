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
          AI Overview Citation Monitor
        </h1>
        <p className="text-sm text-[var(--muted)]">
          linovhr.com · Google Indonesia
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sign in to your account</CardTitle>
          <CardDescription>
            Only email addresses registered on the allowlist can sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm initialError={params.error} />
        </CardContent>
      </Card>
    </main>
  );
}
