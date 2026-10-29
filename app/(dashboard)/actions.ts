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

async function requireAllowedAdminUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEmailAllowed(user.email)) {
    throw new Error("Akses ditolak. Sesi Anda tidak valid atau tidak diizinkan.");
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
    .min(2, "Keyword minimal 2 karakter")
    .max(200, "Keyword maksimal 200 karakter"),
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
      message: parsed.error.issues[0]?.message ?? "Input keyword tidak valid.",
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
        message: `Gagal menyimpan grup: ${grpErr?.message ?? "unknown"}`,
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
      return { ok: false, message: "Keyword tersebut sudah terdaftar." };
    }
    return { ok: false, message: `Gagal menyimpan keyword: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Keyword berhasil disimpan." };
}

const uuidSchema = z.string().uuid("ID tidak valid");

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
    return { ok: false, message: `Gagal mengubah status: ${error.message}` };
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
    return { ok: false, message: `Gagal menghapus keyword: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama grup minimal 2 karakter")
    .max(80, "Nama grup maksimal 80 karakter"),
});

export async function addKeywordGroupAction(formData: FormData) {
  await requireAllowedAdminUser();
  const parsed = groupSchema.safeParse({
    name: String(formData.get("name") ?? ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Nama grup tidak valid.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("keyword_groups")
    .insert({ name: parsed.data.name });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Grup dengan nama tersebut sudah ada." };
    }
    return { ok: false, message: `Gagal menambah grup: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Grup berhasil ditambahkan." };
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
    return { ok: false, message: `Gagal menghapus grup: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

const brandTermSchema = z.object({
  term: z
    .string()
    .trim()
    .min(2, "Istilah merek minimal 2 karakter")
    .max(100, "Istilah merek maksimal 100 karakter"),
});

export async function addBrandTermAction(formData: FormData) {
  await requireAllowedAdminUser();
  const parsed = brandTermSchema.safeParse({
    term: String(formData.get("term") ?? ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Istilah merek tidak valid.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("brand_terms").insert({
    term: parsed.data.term,
    enabled: true,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Istilah merek tersebut sudah ada." };
    }
    return { ok: false, message: `Gagal menyimpan istilah: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Istilah merek ditambahkan." };
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
    return { ok: false, message: `Gagal memperbarui istilah: ${error.message}` };
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
    return { ok: false, message: `Gagal menghapus istilah: ${error.message}` };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

const competitorSchema = z.object({
  name: z.string().trim().min(2, "Nama kompetitor minimal 2 karakter").max(100),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9-]+(\.[a-z0-9-]+)+$/,
      "Domain harus berupa hostname valid tanpa http atau garis miring (contoh: gadjian.com)"
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
        parsed.error.issues[0]?.message ?? "Data kompetitor tidak valid.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("competitors").insert({
    name: parsed.data.name,
    domain: parsed.data.domain,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Domain kompetitor tersebut sudah ada." };
    }
    return {
      ok: false,
      message: `Gagal menyimpan kompetitor: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Kompetitor ditambahkan." };
}

export async function deleteCompetitorAction(competitorId: string) {
  await requireAllowedAdminUser();
  const id = uuidSchema.parse(competitorId);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("competitors").delete().eq("id", id);

  if (error) {
    return {
      ok: false,
      message: `Gagal menghapus kompetitor: ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return { ok: true };
}

const searchSettingsSchema = z.object({
  location: z.string().trim().min(2, "Lokasi wajib diisi"),
  google_domain: z.string().trim().min(3, "Domain Google wajib diisi"),
  gl: z.string().trim().length(2, "Kode negara (gl) harus 2 huruf"),
  hl: z.string().trim().min(2, "Kode bahasa (hl) minimal 2 huruf"),
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
      message: parsed.error.issues[0]?.message ?? "Pengaturan tidak valid.",
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
      message: `Gagal menyimpan pengaturan (pastikan tabel settings sudah dimigrasi): ${error.message}`,
    };
  }

  revalidateAllDashboardRoutes();
  return { ok: true, message: "Pengaturan lokasi dan bahasa berhasil disimpan." };
}

export async function runCheckNowAction() {
  await requireAllowedAdminUser();

  const supabase = createSupabaseAdminClient();
  const store = createSupabaseQueueStore(supabase);

  const started = await startCheckRun(store);
  const processed = await processQueue(store, {
    maxDurationMs: 45_000,
  });

  revalidateAllDashboardRoutes();

  return {
    ok: true,
    runId: started.runId,
    isExisting: started.isExisting,
    processedCount: processed.processedCount,
    succeededCount: processed.succeededCount,
    serpApiCallsUsed: processed.serpApiCallsUsedInBatch,
    stoppedReason: processed.stoppedReason,
  };
}

export async function clearDemoDataAction() {
  await requireAllowedAdminUser();

  const supabase = createSupabaseAdminClient();

  // Ambil semua run_id yang memiliki checks dengan dry_run = true
  const { data: dryChecks } = await supabase
    .from("checks")
    .select("run_id, raw");

  const demoRunIds = new Set<string>();
  for (const c of dryChecks ?? []) {
    const typed = c as { run_id: string; raw: Record<string, unknown> | null };
    if (typed.raw?.dry_run === true) {
      demoRunIds.add(typed.run_id);
    }
  }

  // Hapus check_runs dengan is_demo = true (jika kolom ada)
  await supabase.from("check_runs").delete().eq("is_demo", true);

  if (demoRunIds.size > 0) {
    await supabase
      .from("check_runs")
      .delete()
      .in("id", Array.from(demoRunIds));
  }

  revalidateAllDashboardRoutes();
  return {
    ok: true,
    message: "Seluruh data contoh berhasil dihapus.",
  };
}
