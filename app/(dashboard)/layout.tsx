import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth";
import { logoutAction } from "@/app/(auth)/login/actions";
import { DashboardNav } from "@/components/dashboard-nav";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEmailAllowed(user.email)) {
    redirect("/login?error=forbidden");
  }

  return (
    <div className="mx-auto max-w-[1040px] px-4 pt-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-[22px] font-extrabold tracking-tight">
            Pemantau kutipan AI Overview
          </h1>
          <p className="m-0 text-sm text-[var(--muted)]">
            linovhr.com · Google Indonesia
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--muted)]">{user.email}</span>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Keluar dari akun
            </Button>
          </form>
        </div>
      </header>

      <DashboardNav />

      <main>{children}</main>
    </div>
  );
}
