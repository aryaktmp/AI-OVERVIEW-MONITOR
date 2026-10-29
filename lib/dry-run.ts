/**
 * Single source of truth for SERPAPI_DRY_RUN evaluation.
 *
 * Rules:
 * - "true" or "1" -> dry run (true)
 * - Only "false" or "0" -> real mode (false)
 * - Empty string, undefined, null, or any other value -> dry run (true) (fail-safe)
 */
export function isDryRun(value?: string | null): boolean {
  const envVal = value !== undefined ? value : process.env.SERPAPI_DRY_RUN;
  if (envVal === undefined || envVal === null) {
    return true;
  }
  const normalized = envVal.trim().toLowerCase();
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return true;
}
