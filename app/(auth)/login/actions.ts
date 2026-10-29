"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isEmailAllowed, loginSchema } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthActionState {
  status: "idle" | "error" | "success";
  message: string;
}

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const rawInput = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    mode: String(formData.get("mode") ?? "password"),
  };

  const parsed = loginSchema.safeParse(rawInput);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      status: "error",
      message: firstIssue?.message ?? "Input tidak valid.",
    };
  }

  const { email, password, mode } = parsed.data;

  // Periksa allowlist terlebih dahulu: tolak pengguna di luar ALLOWED_EMAILS
  if (!isEmailAllowed(email)) {
    return {
      status: "error",
      message:
        "Email Anda tidak ada dalam daftar izin akses. Hubungi administrator.",
    };
  }

  const supabase = await createSupabaseServerClient();

  if (mode === "otp") {
    const headerList = await headers();
    const host = headerList.get("host") ?? "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    const emailRedirectTo = `${protocol}://${host}/auth/callback`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });

    if (error) {
      return {
        status: "error",
        message: "Gagal mengirim tautan masuk. Periksa email Anda atau coba lagi.",
      };
    }

    return {
      status: "success",
      message:
        "Tautan masuk telah dikirim ke email Anda. Buka kotak masuk untuk melanjutkan.",
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: password ?? "",
  });

  if (error || !data.user) {
    return {
      status: "error",
      message: "Email atau kata sandi salah. Periksa kembali data Anda.",
    };
  }

  if (!isEmailAllowed(data.user.email)) {
    await supabase.auth.signOut();
    return {
      status: "error",
      message:
        "Email Anda tidak ada dalam daftar izin akses. Hubungi administrator.",
    };
  }

  redirect("/ringkasan");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
