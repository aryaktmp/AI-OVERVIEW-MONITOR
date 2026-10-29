import { z } from "zod";

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1, "Email address is required")
      .email("Invalid email address format"),
    password: z.string().optional(),
    mode: z.enum(["password", "otp"]).default("password"),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "password" && (!val.password || val.password.length < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "Password is required",
      });
    }
  });

export type LoginInput = z.infer<typeof loginSchema>;

export function parseAllowedEmails(
  rawAllowedEmails: string | undefined = process.env.ALLOWED_EMAILS
): string[] {
  if (!rawAllowedEmails) return [];
  return rawAllowedEmails
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isEmailAllowed(
  email: string | null | undefined,
  rawAllowedEmails: string | undefined = process.env.ALLOWED_EMAILS
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const allowedList = parseAllowedEmails(rawAllowedEmails);
  return allowedList.includes(normalized);
}
