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
      message: firstIssue?.message ?? "Invalid input.",
    };
  }

  const { email, password, mode } = parsed.data;

  // Check allowlist first: reject users outside ALLOWED_EMAILS
  if (!isEmailAllowed(email)) {
    return {
      status: "error",
      message:
        "Your email is not on the access allowlist. Please contact the administrator.",
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
        message: "Failed to send sign-in link. Please check your email or try again later.",
      };
    }

    return {
      status: "success",
      message:
        "Sign-in link sent to your email. Please check your inbox to continue.",
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: password ?? "",
  });

  if (error || !data.user) {
    return {
      status: "error",
      message: "Invalid email or password. Please verify your credentials.",
    };
  }

  if (!isEmailAllowed(data.user.email)) {
    await supabase.auth.signOut();
    return {
      status: "error",
      message:
        "Your email is not on the access allowlist. Please contact the administrator.",
    };
  }

  redirect("/ringkasan");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
