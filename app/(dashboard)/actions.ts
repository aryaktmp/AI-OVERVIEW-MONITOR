"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";
import {
  createSupabaseQueueStore,
  processQueue,
  startCheckRun,
} from "@/lib/queue";
import { clearAllDemoData } from "@/lib/demo-data";
import { MAX_CSV_IMPORT_ROWS, parseKeywordCsvPreview } from "@/lib/csv-import";
import { isDryRun } from "@/lib/dry-run";
import {
  overrideActiveKeywordBatch,
  setBatchScheduleMode,
  assignKeywordsToBatch,
  updateKeywordBatch,
  updateBatchWithKeywords,
  createKeywordBatch,
  listKeywordsForBatchSelection,
  deleteKeywordBatch,
  assignBatchToSlot,
  resetSlotsToDefault,
  rotateActiveBatchBySlot,
  listKeywordBatches,
  getBatchScheduleSettings,
  getScheduledBatchForDate,
  activateKeywordBatch,
  syncScheduledKeywordBatch,
  getJakartaWeekBoundaries,
  type BatchScheduleMode,
} from "@/lib/keyword-batches";

async function requireAllowedAdminUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEmailAllowed(user.email)) {
    throw new Error(
      "Access denied. Your session is invalid or not authorized."
    );
  }

  return user;
}

function revalidateAllDashboardRoutes() {
  revalidatePath("/overview");
  revalidatePath("/keywords");
  revalidatePath("/competitors");
  revalidatePath("/settings");
  revalidatePath("/ringkasan");
  revalidatePath("/keyword");
  revalidatePath("/kompetitor");
  revalidatePath("/pengaturan");
}

const addKeywordSchema = z.object({
  text: z
    .string()
    .trim()
    .min(2, "Keyword must be at least 2 characters")
    .max(200, "Keyword must be at most 200 characters"),
  groupId: z.string().trim().optional(),
  newGroupName: z.string().trim().max(80).optional(),
  batchId: z.string().trim().optional(),
});

export async function addKeywordAction(formData: FormData) {
  await requireAllowedAdminUser();

  const parsed = addKeywordSchema.safeParse({
    text: String(formData.get("text") ?? ""),
    groupId: String(formData.get("groupId") ?? ""),
    newGroupName: String(formData.get("newGroupName") ?? ""),
    batchId: String(formData.get("batchId") ?? ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid keyword input.",
    };
  }

  const supabase = createSupabaseAdminClient();
  let targetGroupId: string | null = parsed.data.groupId || null;

  if (parsed.data.newGroupName) {
    const { data: grp, error: grpErr } = await supabase
      .from("keyword_groups")
      .upsert({ name: parsed.data.newGroupName }, { onConflict: "name" })
      .select("id")
      .single();

    if (grpErr || !grp) {
      return {
        ok: false,
        message: `Failed to save group: ${grpErr?.message ?? "unknown"}`,
      };
    }
    targetGroupId = (grp as { id: string }).id;
  }

  const { error } = await supabase.from("keywords").insert({
    text: parsed.data.text,
    group_id: targetGroupId,
    batch_id: parsed.data.batchId || null,
    active: true,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "This keyword is already registered." };
    }
    return { ok: false, message: `Failed to save keyword: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Keyword saved successfully." };
}

export async function importKeywordsCsvAction(formData: FormData) {
  await requireAllowedAdminUser();

  const csvText = String(formData.get("csvText") ?? "");
  if (!csvText.trim()) {
    return {
      ok: false,
      message: "CSV file content cannot be empty.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const [{ data: existingKwRows }, { data: existingGrpRows }] =
    await Promise.all([
      supabase.from("keywords").select("text"),
      supabase.from("keyword_groups").select("id, name"),
    ]);

  const existingKeywords = (existingKwRows ?? []).map(
    (r: { text: string }) => r.text
  );
  const existingGroups = (existingGrpRows ?? []) as Array<{
    id: string;
    name: string;
  }>;

  const preview = parseKeywordCsvPreview(
    csvText,
    existingKeywords,
    existingGroups.map((g) => g.name)
  );

  if (preview.exceededMaxRows) {
    return {
      ok: false,
      message: `Import rejected: row count exceeds maximum limit of ${MAX_CSV_IMPORT_ROWS} rows per import.`,
    };
  }

  if (preview.validRows.length === 0) {
    return {
      ok: false,
      message: "No new valid keywords to save.",
    };
  }

  const groupIdByLowerName = new Map<string, string>();
  for (const grp of existingGroups) {
    groupIdByLowerName.set(grp.name.trim().toLowerCase(), grp.id);
  }

  if (preview.newGroupsToCreate.length > 0) {
    const { data: createdGroups, error: grpErr } = await supabase
      .from("keyword_groups")
      .upsert(
        preview.newGroupsToCreate.map((name) => ({ name })),
        { onConflict: "name" }
      )
      .select("id, name");

    if (grpErr) {
      return {
        ok: false,
        message: `Failed to create new group: ${grpErr.message}`,
      };
    }

    for (const grp of (createdGroups ?? []) as Array<{
      id: string;
      name: string;
    }>) {
      groupIdByLowerName.set(grp.name.trim().toLowerCase(), grp.id);
    }
  }

  const rowsToInsert = preview.validRows.map((row) => ({
    text: row.keyword,
    group_id: row.group
      ? (groupIdByLowerName.get(row.group.toLowerCase()) ?? null)
      : null,
    active: true,
  }));

  const { error: insertErr } = await supabase
    .from("keywords")
    .insert(rowsToInsert);

  if (insertErr) {
    return {
      ok: false,
      message: `Failed to import keywords: ${insertErr.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return {
    ok: true,
    message: `Successfully imported ${preview.validRows.length} new keywords (${preview.duplicateRows.length} duplicates skipped, ${preview.invalidRows.length} invalid).`,
    insertedCount: preview.validRows.length,
    duplicateCount: preview.duplicateRows.length,
    invalidCount: preview.invalidRows.length,
    createdGroupsCount: preview.newGroupsToCreate.length,
  };
}

const uuidSchema = z.string().uuid("Invalid ID");

export async function toggleKeywordActiveAction(
  keywordId: string,
  nextActive: boolean
) {
  await requireAllowedAdminUser();
  const id = uuidSchema.parse(keywordId);
  const active = z.boolean().parse(nextActive);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("keywords")
    .update({ active })
    .eq("id", id);

  if (error) {
    return { ok: false, message: `Failed to update status: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

export async function deleteKeywordAction(keywordId: string) {
  await requireAllowedAdminUser();
  const id = uuidSchema.parse(keywordId);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("keywords").delete().eq("id", id);

  if (error) {
    return { ok: false, message: `Failed to delete keyword: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

export async function bulkToggleKeywordsActiveAction(
  keywordIds: string[],
  nextActive: boolean
) {
  await requireAllowedAdminUser();
  const ids = z
    .array(uuidSchema)
    .min(1, "At least one keyword must be selected")
    .parse(keywordIds);
  const active = z.boolean().parse(nextActive);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("keywords")
    .update({ active })
    .in("id", ids);

  if (error) {
    return {
      ok: false,
      message: `Failed to update keywords: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return {
    ok: true,
    count: ids.length,
    message: `Successfully ${active ? "activated" : "deactivated"} ${ids.length} keyword(s).`,
  };
}

export async function bulkDeleteKeywordsAction(keywordIds: string[]) {
  await requireAllowedAdminUser();
  const ids = z
    .array(uuidSchema)
    .min(1, "At least one keyword must be selected")
    .parse(keywordIds);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("keywords").delete().in("id", ids);

  if (error) {
    return {
      ok: false,
      message: `Failed to delete keywords: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return {
    ok: true,
    count: ids.length,
    message: `Successfully deleted ${ids.length} keyword(s).`,
  };
}

export async function bulkAssignKeywordsBatchAction(
  keywordIds: string[],
  batchId: string | null
) {
  await requireAllowedAdminUser();
  const ids = z
    .array(uuidSchema)
    .min(1, "At least one keyword must be selected")
    .parse(keywordIds);
  const targetBatchId = batchId ? uuidSchema.parse(batchId) : null;

  const supabase = createSupabaseAdminClient();
  await assignKeywordsToBatch(supabase, ids, targetBatchId);

  revalidateAllDashboardRoutes();
  return {
    ok: true,
    count: ids.length,
    message: targetBatchId
      ? `Successfully assigned ${ids.length} keyword(s) to batch.`
      : `Successfully unassigned ${ids.length} keyword(s) from batch.`,
  };
}

const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Group name must be at least 2 characters")
    .max(80, "Group name must be at most 80 characters"),
});

export async function addKeywordGroupAction(formData: FormData) {
  await requireAllowedAdminUser();
  const parsed = groupSchema.safeParse({
    name: String(formData.get("name") ?? ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid group name.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("keyword_groups")
    .insert({ name: parsed.data.name });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "A group with this name already exists." };
    }
    return { ok: false, message: `Failed to add group: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Group added successfully." };
}

export async function deleteKeywordGroupAction(groupId: string) {
  await requireAllowedAdminUser();
  const id = uuidSchema.parse(groupId);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("keyword_groups").delete().eq("id", id);

  if (error) {
    return { ok: false, message: `Failed to delete group: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

const brandTermSchema = z.object({
  term: z
    .string()
    .trim()
    .min(2, "Brand term must be at least 2 characters")
    .max(100, "Brand term must be at most 100 characters"),
});

export async function addBrandTermAction(formData: FormData) {
  await requireAllowedAdminUser();
  const parsed = brandTermSchema.safeParse({
    term: String(formData.get("term") ?? ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid brand term.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("brand_terms").insert({
    term: parsed.data.term,
    enabled: true,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "This brand term already exists." };
    }
    return {
      ok: false,
      message: `Failed to save brand term: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Brand term added successfully." };
}

export async function toggleBrandTermAction(termId: string, enabled: boolean) {
  await requireAllowedAdminUser();
  const id = uuidSchema.parse(termId);
  const validEnabled = z.boolean().parse(enabled);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("brand_terms")
    .update({ enabled: validEnabled })
    .eq("id", id);

  if (error) {
    return {
      ok: false,
      message: `Failed to update brand term: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

export async function deleteBrandTermAction(termId: string) {
  await requireAllowedAdminUser();
  const id = uuidSchema.parse(termId);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("brand_terms").delete().eq("id", id);

  if (error) {
    return {
      ok: false,
      message: `Failed to delete brand term: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

const competitorSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Competitor name must be at least 2 characters")
    .max(100),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9-]+(\.[a-z0-9-]+)+$/,
      "Domain must be a valid hostname without http or trailing slashes (e.g. talenta.co)"
    ),
});

export async function addCompetitorAction(formData: FormData) {
  await requireAllowedAdminUser();
  const parsed = competitorSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    domain: String(formData.get("domain") ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid competitor data.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("competitors").insert({
    name: parsed.data.name,
    domain: parsed.data.domain,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "This competitor domain already exists." };
    }
    return {
      ok: false,
      message: `Failed to save competitor: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Competitor added successfully." };
}

export async function deleteCompetitorAction(competitorId: string) {
  await requireAllowedAdminUser();
  const id = uuidSchema.parse(competitorId);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("competitors").delete().eq("id", id);

  if (error) {
    return {
      ok: false,
      message: `Failed to delete competitor: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

const searchSettingsSchema = z.object({
  location: z.string().trim().min(2, "Location is required"),
  google_domain: z.string().trim().min(3, "Google domain is required"),
  gl: z.string().trim().length(2, "Country code (gl) must be 2 letters"),
  hl: z.string().trim().min(2, "Language code (hl) must be at least 2 letters"),
  enable_third_party_check: z.boolean(),
});

export async function saveSearchSettingsAction(formData: FormData) {
  await requireAllowedAdminUser();
  const parsed = searchSettingsSchema.safeParse({
    location: String(formData.get("location") ?? "Indonesia"),
    google_domain: String(formData.get("google_domain") ?? "google.co.id"),
    gl: String(formData.get("gl") ?? "id"),
    hl: String(formData.get("hl") ?? "id"),
    enable_third_party_check:
      formData.get("enable_third_party_check") === "true" ||
      formData.get("enable_third_party_check") === "on",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid settings.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("settings").upsert(
    {
      key: "search_config",
      value: parsed.data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    return {
      ok: false,
      message: `Failed to save settings (ensure settings table is migrated): ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return {
    ok: true,
    message: "Location and language settings saved successfully.",
  };
}

export async function runCheckNowAction(options?: { force?: boolean }) {
  await requireAllowedAdminUser();

  const supabase = createSupabaseAdminClient();
  const store = createSupabaseQueueStore(supabase);

  const now = new Date();
  const isDemo = isDryRun();

  // 1. Tentukan batch terjadwal minggu ini (atau override aktif)
  const [allBatches, scheduleSettings] = await Promise.all([
    listKeywordBatches(supabase),
    getBatchScheduleSettings(supabase),
  ]);

  const activeBatch = allBatches.find((b) => b.is_active) ?? null;
  const scheduled = getScheduledBatchForDate(now, allBatches, {
    mode: scheduleSettings.mode,
    override_until: scheduleSettings.override_until,
    activeBatchId: activeBatch?.id,
  });

  const targetBatch = scheduled.batch;

  // 2. Sinkronkan batch aktif bila berbeda (agar UI sinkron)
  if (targetBatch && !targetBatch.is_active) {
    await activateKeywordBatch(supabase, targetBatch.id, {
      actorId: "admin:manual_run",
      notes: scheduled.isOverride
        ? `Aktivasi manual override (${targetBatch.name})`
        : `Aktivasi jadwal turunan minggu ${scheduled.targetWeekMonday} (${targetBatch.name})`,
    }).catch(() => null);
  }

  // 3. Idempoten per minggu Jakarta jika bukan force dan bukan demo
  if (!options?.force && !isDemo) {
    const { startIso, endIso } = getJakartaWeekBoundaries(now);
    const { data: existingRuns } = await supabase
      .from("check_runs")
      .select("id, status, total, started_at, is_demo")
      .eq("is_demo", false)
      .in("status", ["running", "done"])
      .gte("started_at", startIso)
      .lte("started_at", endIso)
      .order("started_at", { ascending: false })
      .limit(1);

    if (existingRuns && existingRuns.length > 0) {
      const existing = existingRuns[0]!;
      revalidateAllDashboardRoutes();
      return {
        ok: true,
        runId: existing.id,
        isExisting: true,
        skipped: "already_ran_this_week" as const,
        message: `A check run has already run this week (run ID: ${existing.id}).`,
        total: existing.total,
        done: 0,
        pending: 0,
        errors: 0,
        processedCount: 0,
        succeededCount: 0,
        serpApiCallsUsed: 0,
      };
    }
  }

  // 4. Mulai check run
  const started = await startCheckRun(store, now, {
    batchId: targetBatch?.id,
    isDemo,
  });

  if (started.skipped) {
    revalidateAllDashboardRoutes();
    let message = "No active keywords found to check.";
    if (started.skipped === "empty_batch") {
      message = `The scheduled batch "${targetBatch?.name ?? "Current batch"}" has no active keywords.`;
    } else if (started.skipped === "monthly_budget") {
      message = "Monthly SerpApi budget limit reached. Check skipped.";
    } else if (started.skipped === "no_active_batch") {
      message = "No active batch found.";
    } else if (started.skipped === "already_ran_this_week") {
      message = "A check run has already run this week.";
    }

    return {
      ok: true,
      skipped: started.skipped,
      message,
      total: 0,
      done: 0,
      pending: 0,
      errors: 0,
      processedCount: 0,
      succeededCount: 0,
      serpApiCallsUsed: 0,
    };
  }

  const processed = await processQueue(store, {
    maxItems: 5,
    maxDurationMs: 15_000,
    dryRun: started.isDemo,
  });

  const runSummary =
    processed.runsSummary.find((r) => r.runId === started.runId) ??
    (await store.syncRunProgress(
      started.runId,
      new Date().toISOString(),
      started.isDemo
    ));

  revalidateAllDashboardRoutes();

  return {
    ok: true,
    runId: started.runId,
    isExisting: started.isExisting,
    status: runSummary.status,
    total: runSummary.total,
    done: runSummary.done,
    pending: runSummary.pending,
    errors: runSummary.errors,
    processedCount: processed.processedCount,
    succeededCount: processed.succeededCount,
    serpApiCallsUsed: runSummary.serpApiCalls,
    stoppedReason: processed.stoppedReason,
  };
}

export async function processRunBatchAction(runId?: string) {
  await requireAllowedAdminUser();

  const supabase = createSupabaseAdminClient();
  const store = createSupabaseQueueStore(supabase);
  const isDryRunEnv = isDryRun();

  // Mode pemrosesan mengikuti run:
  // Run is_demo=true hanya diproses dalam mode dry run (isDryRunEnv === true).
  // Run is_demo=false hanya diproses saat isDryRun() bernilai false (!isDryRunEnv).
  // Jika tidak cocok, item dilewati tanpa mengubah state, dan respons memuat stoppedReason: "mode_mismatch".
  let targetRunId = runId;
  let targetRunIsDemo: boolean | null = null;

  if (targetRunId) {
    const { data: runRow } = await supabase
      .from("check_runs")
      .select("id, is_demo")
      .eq("id", targetRunId)
      .maybeSingle();
    if (runRow) {
      targetRunIsDemo = Boolean(runRow.is_demo);
    }
  } else {
    const runningRun = await store.getRunningCheckRun();
    if (runningRun) {
      targetRunId = runningRun.id;
      targetRunIsDemo = Boolean(runningRun.is_demo);
    }
  }

  if (targetRunId && targetRunIsDemo !== null) {
    const isMismatch = targetRunIsDemo !== isDryRunEnv;
    if (isMismatch) {
      const summary = await store.syncRunProgress(
        targetRunId,
        new Date().toISOString(),
        targetRunIsDemo
      );
      return {
        ok: true,
        runId: summary.runId,
        status: summary.status,
        total: summary.total,
        done: summary.done,
        pending: summary.pending,
        errors: summary.errors,
        processedCount: 0,
        succeededCount: 0,
        serpApiCallsUsed: summary.serpApiCalls,
        stoppedReason: "mode_mismatch" as const,
      };
    }
  }

  const processed = await processQueue(store, {
    maxItems: 5,
    maxDurationMs: 15_000,
    dryRun: isDryRunEnv,
  });

  const resolvedRunId =
    targetRunId ??
    processed.runsSummary[0]?.runId ??
    (await store.getRunningCheckRun())?.id ??
    null;

  if (!resolvedRunId) {
    revalidateAllDashboardRoutes();
    return {
      ok: true,
      runId: null,
      status: "done" as const,
      total: 0,
      done: 0,
      pending: 0,
      errors: 0,
      processedCount: processed.processedCount,
      succeededCount: processed.succeededCount,
      serpApiCallsUsed: processed.serpApiCallsUsedInBatch,
      stoppedReason: processed.stoppedReason,
    };
  }

  const runSummary =
    processed.runsSummary.find((r) => r.runId === resolvedRunId) ??
    (await store.syncRunProgress(resolvedRunId, new Date().toISOString()));

  revalidateAllDashboardRoutes();

  return {
    ok: true,
    runId: runSummary.runId,
    status: runSummary.status,
    total: runSummary.total,
    done: runSummary.done,
    pending: runSummary.pending,
    errors: runSummary.errors,
    processedCount: processed.processedCount,
    succeededCount: processed.succeededCount,
    serpApiCallsUsed: runSummary.serpApiCalls,
    stoppedReason: processed.stoppedReason,
  };
}

export async function clearDemoDataAction() {
  await requireAllowedAdminUser();

  const supabase = createSupabaseAdminClient();
  await clearAllDemoData(supabase);

  revalidateAllDashboardRoutes();
  return {
    ok: true,
    message:
      "All demo data in check_runs, keywords, keyword_groups, and competitors has been permanently cleared.",
  };
}

export async function rotateBatchNowAction() {
  const user = await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  const result = await syncScheduledKeywordBatch(supabase, {
    actorId: user.email ?? "admin",
    force: true,
  });

  revalidateAllDashboardRoutes();
  return {
    status: result.status,
    newBatch: result.scheduledBatch,
    message: result.message,
  };
}

export async function overrideActiveBatchAction(
  targetBatchId: string,
  freezeMode: boolean = false,
  overrideUntil?: string | null
) {
  const user = await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  const result = await overrideActiveKeywordBatch(supabase, targetBatchId, {
    actorId: user.email ?? "admin",
    freezeMode,
    overrideUntil,
  });

  revalidateAllDashboardRoutes();
  return result;
}

export async function updateBatchScheduleModeAction(mode: BatchScheduleMode) {
  const user = await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  const result = await setBatchScheduleMode(
    supabase,
    mode,
    user.email ?? "admin"
  );

  revalidateAllDashboardRoutes();
  return { ok: true, settings: result };
}

export async function updateKeywordBatchAction(
  keywordId: string,
  batchId: string | null
) {
  await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  await assignKeywordsToBatch(supabase, [keywordId], batchId);

  revalidateAllDashboardRoutes();
  return { ok: true };
}

export async function toggleBatchEnabledAction(
  batchId: string,
  isEnabled: boolean
) {
  await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  const result = await updateKeywordBatch(supabase, batchId, { isEnabled });

  revalidateAllDashboardRoutes();
  return { ok: true, batch: result };
}

export async function createBatchAction(
  name: string,
  description?: string,
  color?: string,
  keywordIds?: string[],
  keywordsText?: string | string[]
) {
  await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  const result = await createKeywordBatch(supabase, {
    name,
    description,
    keywordIds: keywordIds ?? [],
    keywords: keywordsText,
  });

  revalidateAllDashboardRoutes();
  return { ok: true, batch: result, keywordsCount: result.keywordsCount };
}

export async function updateBatchWithKeywordsAction(
  batchId: string,
  name: string,
  description?: string,
  color?: string,
  keywordIds?: string[],
  newKeywordsText?: string
) {
  const user = await requireAllowedAdminUser();
  const validBatchId = uuidSchema.parse(batchId);
  const validName = z
    .string()
    .trim()
    .min(2, "Batch name must be at least 2 characters")
    .parse(name);
  const validIds = keywordIds
    ? z.array(uuidSchema).parse(keywordIds)
    : undefined;

  const supabase = createSupabaseAdminClient();
  const result = await updateBatchWithKeywords(supabase, validBatchId, {
    name: validName,
    description: description ? description.trim() : null,
    color: color ? color.trim() : undefined,
    keywordIds: validIds,
    newKeywordsText: newKeywordsText ? newKeywordsText.trim() : undefined,
    actorId: user.email ?? "admin",
  });

  revalidateAllDashboardRoutes();
  return { ok: true, batch: result.batch, keywordsCount: result.keywordsCount };
}

export async function getSelectableKeywordsAction() {
  await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();
  return listKeywordsForBatchSelection(supabase);
}

export async function assignBatchToSlotAction(
  weekNumber: number,
  batchId: string | null,
  isOverride: boolean = true
) {
  const user = await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  const result = await assignBatchToSlot(
    supabase,
    weekNumber,
    batchId,
    isOverride,
    user.email ?? "admin"
  );

  revalidateAllDashboardRoutes();
  return result;
}

export async function resetSlotsToDefaultAction() {
  const user = await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  const result = await resetSlotsToDefault(supabase, user.email ?? "admin");

  revalidateAllDashboardRoutes();
  return result;
}

export async function rotateBatchBySlotAction(force: boolean = false) {
  const user = await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  const result = await rotateActiveBatchBySlot(supabase, {
    actorId: user.email ?? "admin",
    force,
  });

  revalidateAllDashboardRoutes();
  return result;
}

export async function deleteBatchAction(batchId: string) {
  await requireAllowedAdminUser();
  const supabase = createSupabaseAdminClient();

  await deleteKeywordBatch(supabase, batchId);

  revalidateAllDashboardRoutes();
  return { ok: true };
}
