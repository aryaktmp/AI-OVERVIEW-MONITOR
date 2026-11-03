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
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Sticky Top Header & Main Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur-md transition-shadow">
        <div className="mx-auto max-w-[1040px] px-4 pt-3.5 pb-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="m-0 text-[20px] font-extrabold tracking-tight text-[var(--ink)]">
                AI Overview Citation Monitor
              </h1>
              <p className="m-0 text-xs text-[var(--muted)]">
                linovhr.com · Google Indonesia
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--muted)]">{user.email}</span>
              <form action={logoutAction}>
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            </div>
          </div>

          <DashboardNav />
        </div>
      </header>

      {/* Main Content Area */}
      <div className="mx-auto max-w-[1040px] px-4 pt-5 pb-12">
        <main>{children}</main>
      </div>
    </div>
  );
}
