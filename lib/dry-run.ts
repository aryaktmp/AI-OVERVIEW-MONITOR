export type DryRunExplicitState = "explicit-true" | "explicit-false" | "unset";

/**
 * Single source of truth for SERPAPI_DRY_RUN evaluation.
 *
 * Rules:
 * - "true" or "1" -> dry run (true)
 * - Only "false" or "0" -> real mode (false)
 * - Empty string, undefined, null, or any other value -> dry run (true) (fail-safe)
 */
export function isDryRunExplicit(
  value?: string | null
): DryRunExplicitState {
  const envVal = value !== undefined ? value : process.env.SERPAPI_DRY_RUN;
  if (envVal === undefined || envVal === null) {
    return "unset";
  }
  const normalized = envVal.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return "explicit-true";
  }
  if (normalized === "false" || normalized === "0") {
    return "explicit-false";
  }
  return "unset";
}

export function isDryRun(value?: string | null): boolean {
  return isDryRunExplicit(value) !== "explicit-false";
}

