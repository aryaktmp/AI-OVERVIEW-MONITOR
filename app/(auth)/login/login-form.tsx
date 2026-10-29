"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { loginAction, type AuthActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
        ? "Your email is not on the access allowlist. Access denied."
        : initialError === "callback"
          ? "The sign-in link is invalid or has expired. Please request a new link."
          : initialError === "config"
            ? "Supabase configuration is incomplete on the server."
            : "";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mode" value={mode} />

      <Tabs
        value={mode}
        onValueChange={(val) => setMode(val as "password" | "otp")}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="otp">Email link (OTP)</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="name@linovhr.com"
          required
          autoComplete="email"
          disabled={isPending}
        />
      </div>

      {mode === "password" && (
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            required
            autoComplete="current-password"
            disabled={isPending}
          />
        </div>
      )}

      {errorMessage && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {state.status === "success" && (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={isPending}
      >
        {isPending
          ? "Processing request..."
          : mode === "password"
            ? "Sign in to dashboard"
            : "Send sign-in link"}
      </Button>
    </form>
  );
}
