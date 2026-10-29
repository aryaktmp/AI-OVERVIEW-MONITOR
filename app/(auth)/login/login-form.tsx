"use client";

import { useActionState, useState } from "react";
import { loginAction, type AuthActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: AuthActionState = {
  status: "idle",
  message: "",
};

export function LoginForm({ initialError }: { initialError?: string }) {
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialState
  );

  const errorMessage =
    state.status === "error"
      ? state.message
      : initialError === "forbidden"
        ? "Email Anda tidak ada dalam daftar izin akses. Akses ditolak."
        : initialError === "callback"
          ? "Tautan masuk tidak valid atau sudah kedaluwarsa. Silakan minta tautan baru."
          : initialError === "config"
            ? "Konfigurasi Supabase belum lengkap di server."
            : "";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mode" value={mode} />

      <div className="flex gap-1 rounded-md bg-[var(--none)] p-1">
        <button
          type="button"
          onClick={() => setMode("password")}
          className={`flex-1 rounded py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            mode === "password"
              ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs"
              : "text-[var(--muted)]"
          }`}
        >
          Kata sandi
        </button>
        <button
          type="button"
          onClick={() => setMode("otp")}
          className={`flex-1 rounded py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            mode === "otp"
              ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs"
              : "text-[var(--muted)]"
          }`}
        >
          Tautan email (OTP)
        </button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-xs font-semibold">
          Alamat email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="nama@linovhr.com"
          required
          autoComplete="email"
          disabled={isPending}
        />
      </div>

      {mode === "password" && (
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-xs font-semibold">
            Kata sandi
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Masukkan kata sandi"
            required
            autoComplete="current-password"
            disabled={isPending}
          />
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-[#C0392B]/30 bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]"
        >
          {errorMessage}
        </div>
      )}

      {state.status === "success" && (
        <div
          role="status"
          className="rounded-md border border-[var(--cite)]/30 bg-[var(--cite-bg)] px-3 py-2 text-xs font-medium text-[var(--cite)]"
        >
          {state.message}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={isPending}
      >
        {isPending
          ? "Memproses permintaan..."
          : mode === "password"
            ? "Masuk ke dasbor"
            : "Kirim tautan masuk"}
      </Button>
    </form>
  );
}
