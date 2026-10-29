import crypto from "node:crypto";

export function verifyCronSecret(
  request: Request,
  expectedSecret: string | undefined = process.env.CRON_SECRET
): boolean {
  if (!expectedSecret || !expectedSecret.trim()) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return false;
  }

  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) {
    return false;
  }

  const provided = authHeader.slice(prefix.length).trim();
  if (!provided) {
    return false;
  }

  const expectedBuf = Buffer.from(expectedSecret.trim(), "utf-8");
  const providedBuf = Buffer.from(provided, "utf-8");

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
