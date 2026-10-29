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

async function requireAllowedAdminUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEmailAllowed(user.email)) {
    throw new Error("Access denied. Your session is invalid or not authorized.");
  }

  return user;
}

function revalidateAllDashboardRoutes() {
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
});

export async function addKeywordAction(formData: FormData) {
  await requireAllowedAdminUser();

  const parsed = addKeywordSchema.safeParse({
    text: String(formData.get("text") ?? ""),
    groupId: String(formData.get("groupId") ?? ""),
    newGroupName: String(formData.get("newGroupName") ?? ""),
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
  const { error } = await supabase
    .from("keyword_groups")
    .delete()
    .eq("id", id);

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
    return { ok: false, message: `Failed to save brand term: ${error.message}` };
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
    return { ok: false, message: `Failed to update brand term: ${error.message}` };
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
    return { ok: false, message: `Failed to delete brand term: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

const competitorSchema = z.object({
  name: z.string().trim().min(2, "Competitor name must be at least 2 characters").max(100),
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
      message:
        parsed.error.issues[0]?.message ?? "Invalid competitor data.",
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
  return { ok: true, message: "Location and language settings saved successfully." };
}

export async function runCheckNowAction() {
  await requireAllowedAdminUser();

  const supabase = createSupabaseAdminClient();
  const store = createSupabaseQueueStore(supabase);

  const started = await startCheckRun(store);
  const processed = await processQueue(store, {
    maxItems: 5,
    maxDurationMs: 15_000,
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
  const isDryRunEnv =
    (process.env.SERPAPI_DRY_RUN ?? "").trim().toLowerCase() === "true";

  // Jika SERPAPI_DRY_RUN=false, jangan jalankan pemrosesan untuk run dengan is_demo = true
  if (!isDryRunEnv) {
    const runningRun = await store.getRunningCheckRun();
    if (runningRun?.is_demo && (!runId || runningRun.id === runId)) {
      const summary = await store.syncRunProgress(
        runningRun.id,
        new Date().toISOString(),
        true
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
        stoppedReason: "no_more_items" as const,
      };
    }

    if (runId) {
      const { data: runRow } = await supabase
        .from("check_runs")
        .select("id, is_demo")
        .eq("id", runId)
        .maybeSingle();

      if (runRow?.is_demo) {
        const summary = await store.syncRunProgress(
          runRow.id,
          new Date().toISOString(),
          true
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
          stoppedReason: "no_more_items" as const,
        };
      }
    }
  }

  const processed = await processQueue(store, {
    maxItems: 5,
    maxDurationMs: 15_000,
    dryRun: isDryRunEnv,
  });

  const targetRunId =
    runId ??
    processed.runsSummary[0]?.runId ??
    (await store.getRunningCheckRun())?.id ??
    null;

  if (!targetRunId) {
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
    processed.runsSummary.find((r) => r.runId === targetRunId) ??
    (await store.syncRunProgress(targetRunId, new Date().toISOString()));

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
