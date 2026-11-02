import type { SupabaseClient } from "@supabase/supabase-js";

export type BatchScheduleMode = "auto" | "manual_frozen";

export interface KeywordBatchRecord {
  id: string;
  name: string;
  description: string | null;
  order_index: number;
  is_active: boolean;
  is_enabled: boolean;
  is_demo?: boolean;
  created_at: string;
  updated_at: string;
}

export interface BatchScheduleSettingsRecord {
  id: number;
  mode: BatchScheduleMode;
  override_until: string | null;
  updated_at: string;
}

export interface BatchAuditLogRecord {
  id: string;
  previous_batch_id: string | null;
  new_batch_id: string | null;
  trigger_type:
    | "auto_schedule"
    | "admin_override"
    | "mode_change"
    | "initial_setup"
    | "warning"
    | string;
  actor_id: string;
  notes: string | null;
  created_at: string;
}

export interface BatchWithKeywordsCount extends KeywordBatchRecord {
  totalKeywords: number;
  activeKeywords: number;
}

export interface KeywordWithBatch {
  id: string;
  text: string;
  active: boolean;
  group_id: string | null;
  batch_id: string | null;
  is_demo?: boolean;
  created_at: string;
}

export interface RotateBatchOptions {
  actorId?: string;
  force?: boolean;
  notes?: string;
  now?: Date;
}

export type RotateBatchStatus =
  | "rotated"
  | "skipped_manual_frozen"
  | "skipped_override_active"
  | "skipped_running_run"
  | "no_candidates";

export interface RotateBatchResult {
  status: RotateBatchStatus;
  previousBatch?: KeywordBatchRecord | null;
  newBatch?: KeywordBatchRecord | null;
  message: string;
}

export interface OverrideBatchOptions {
  actorId?: string;
  freezeMode?: boolean;
  overrideUntil?: string | null;
  notes?: string;
  now?: Date;
}

export interface OverrideBatchResult {
  ok: boolean;
  previousBatch: KeywordBatchRecord | null;
  newBatch: KeywordBatchRecord;
  mode: BatchScheduleMode;
  message: string;
}

// In-memory cache untuk active batch (mempercepat query search & zero-downtime)
let activeBatchCache: { record: KeywordBatchRecord | null; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30 * 1000; // 30 detik

/**
 * Mengosongkan cache active batch secara instan.
 */
export function invalidateActiveKeywordBatchCache(): void {
  activeBatchCache = null;
}

/**
 * Mengambil batch yang saat ini berstatus aktif (is_active = true).
 */
export async function getActiveKeywordBatch(
  supabase: SupabaseClient,
  useCache = false
): Promise<KeywordBatchRecord | null> {
  const now = Date.now();
  if (useCache && activeBatchCache && activeBatchCache.expiresAt > now) {
    return activeBatchCache.record;
  }

  const { data, error } = await supabase
    .from("keyword_batches")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal membaca batch aktif: ${error.message}`);
  }

  const record = (data as KeywordBatchRecord | null) ?? null;
  if (useCache) {
    activeBatchCache = { record, expiresAt: now + CACHE_TTL_MS };
  }
  return record;
}

/**
 * Mengambil daftar seluruh batch keyword yang diurutkan berdasarkan order_index asc.
 */
export async function listKeywordBatches(
  supabase: SupabaseClient
): Promise<KeywordBatchRecord[]> {
  const { data, error } = await supabase
    .from("keyword_batches")
    .select("*")
    .order("order_index", { ascending: true });

  if (error) {
    throw new Error(`Gagal membaca daftar batch keyword: ${error.message}`);
  }

  return (data as KeywordBatchRecord[]) ?? [];
}

/**
 * Mengambil daftar seluruh batch beserta agregasi jumlah keyword (total & aktif).
 */
export async function listKeywordBatchesWithCounts(
  supabase: SupabaseClient
): Promise<BatchWithKeywordsCount[]> {
  const [batches, { data: keywordsData, error: kwError }] = await Promise.all([
    listKeywordBatches(supabase),
    supabase.from("keywords").select("id, active, batch_id"),
  ]);

  if (kwError) {
    throw new Error(`Gagal membaca data keyword untuk agregasi batch: ${kwError.message}`);
  }

  const keywords = (keywordsData ?? []) as Array<{
    id: string;
    active: boolean;
    batch_id: string | null;
  }>;

  const countMap = new Map<string, { total: number; active: number }>();

  for (const kw of keywords) {
    if (!kw.batch_id) continue;
    const current = countMap.get(kw.batch_id) ?? { total: 0, active: 0 };
    current.total += 1;
    if (kw.active) {
      current.active += 1;
    }
    countMap.set(kw.batch_id, current);
  }

  return batches.map((batch) => {
    const counts = countMap.get(batch.id) ?? { total: 0, active: 0 };
    return {
      ...batch,
      totalKeywords: counts.total,
      activeKeywords: counts.active,
    };
  });
}

/**
 * Mengambil keyword yang tergabung dalam batch tertentu.
 */
export async function getKeywordsByBatchId(
  supabase: SupabaseClient,
  batchId: string,
  onlyActive = false
): Promise<KeywordWithBatch[]> {
  let query = supabase
    .from("keywords")
    .select("id, text, active, group_id, batch_id, is_demo, created_at")
    .eq("batch_id", batchId)
    .order("text", { ascending: true });

  if (onlyActive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Gagal membaca keyword untuk batch ${batchId}: ${error.message}`);
  }

  return (data as KeywordWithBatch[]) ?? [];
}

/**
 * Menghubungkan satu atau lebih keyword ke batch tertentu.
 */
export async function assignKeywordsToBatch(
  supabase: SupabaseClient,
  keywordIds: string[],
  batchId: string | null
): Promise<void> {
  if (keywordIds.length === 0) return;

  const { error } = await supabase
    .from("keywords")
    .update({ batch_id: batchId })
    .in("id", keywordIds);

  if (error) {
    throw new Error(`Gagal menghubungkan keyword ke batch: ${error.message}`);
  }

  invalidateActiveKeywordBatchCache();
}

/**
 * Membuat entitas batch baru.
 */
export async function createKeywordBatch(
  supabase: SupabaseClient,
  payload: {
    name: string;
    description?: string | null;
    orderIndex?: number;
    isEnabled?: boolean;
  }
): Promise<KeywordBatchRecord> {
  let orderIndex = payload.orderIndex;

  if (typeof orderIndex !== "number") {
    const existing = await listKeywordBatches(supabase);
    const maxOrder = existing.reduce((max, b) => Math.max(max, b.order_index), 0);
    orderIndex = maxOrder + 1;
  }

  const { data, error } = await supabase
    .from("keyword_batches")
    .insert({
      name: payload.name.trim(),
      description: payload.description?.trim() ?? null,
      order_index: orderIndex,
      is_active: false,
      is_enabled: payload.isEnabled ?? true,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Gagal membuat batch baru: ${error.message}`);
  }

  return data as KeywordBatchRecord;
}

/**
 * Memperbarui data entitas batch.
 */
export async function updateKeywordBatch(
  supabase: SupabaseClient,
  batchId: string,
  payload: {
    name?: string;
    description?: string | null;
    orderIndex?: number;
    isEnabled?: boolean;
  }
): Promise<KeywordBatchRecord> {
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (payload.name !== undefined) updatePayload.name = payload.name.trim();
  if (payload.description !== undefined)
    updatePayload.description = payload.description ? payload.description.trim() : null;
  if (payload.orderIndex !== undefined) updatePayload.order_index = payload.orderIndex;
  if (payload.isEnabled !== undefined) updatePayload.is_enabled = payload.isEnabled;

  const { data, error } = await supabase
    .from("keyword_batches")
    .update(updatePayload)
    .eq("id", batchId)
    .select()
    .single();

  if (error) {
    throw new Error(`Gagal memperbarui batch: ${error.message}`);
  }

  invalidateActiveKeywordBatchCache();
  return data as KeywordBatchRecord;
}

/**
 * Menghapus entitas batch.
 */
export async function deleteKeywordBatch(
  supabase: SupabaseClient,
  batchId: string
): Promise<void> {
  const activeBatch = await getActiveKeywordBatch(supabase);
  if (activeBatch && activeBatch.id === batchId) {
    throw new Error("Tidak dapat menghapus batch yang sedang berstatus aktif. Ubah batch aktif terlebih dahulu.");
  }

  const { error } = await supabase
    .from("keyword_batches")
    .delete()
    .eq("id", batchId);

  if (error) {
    throw new Error(`Gagal menghapus batch: ${error.message}`);
  }

  invalidateActiveKeywordBatchCache();
}

/**
 * Mengambil pengaturan mode rotasi jadwal batch saat ini.
 */
export async function getBatchScheduleSettings(
  supabase: SupabaseClient
): Promise<BatchScheduleSettingsRecord> {
  const { data, error } = await supabase
    .from("batch_schedule_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    throw new Error(`Gagal membaca pengaturan jadwal batch: ${error.message}`);
  }

  return data as BatchScheduleSettingsRecord;
}

/**
 * Mengubah mode penjadwalan (auto vs manual_frozen) dan mencatatnya ke audit log.
 */
export async function setBatchScheduleMode(
  supabase: SupabaseClient,
  mode: BatchScheduleMode,
  actorId = "admin",
  notes?: string
): Promise<BatchScheduleSettingsRecord> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("batch_schedule_settings")
    .update({
      mode,
      override_until: null,
      updated_at: nowIso,
    })
    .eq("id", 1)
    .select()
    .single();

  if (error) {
    throw new Error(`Gagal memperbarui mode jadwal: ${error.message}`);
  }

  await supabase.from("batch_audit_logs").insert({
    previous_batch_id: null,
    new_batch_id: null,
    trigger_type: "mode_change",
    actor_id: actorId,
    notes: notes ?? `Mode jadwal diubah menjadi '${mode}'`,
    created_at: nowIso,
  });

  return data as BatchScheduleSettingsRecord;
}

/**
 * Mengambil riwayat log audit perubahan batch keyword.
 */
export async function listBatchAuditLogs(
  supabase: SupabaseClient,
  limit = 50
): Promise<BatchAuditLogRecord[]> {
  const { data, error } = await supabase
    .from("batch_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Gagal membaca log audit batch: ${error.message}`);
  }

  return (data as BatchAuditLogRecord[]) ?? [];
}

/**
 * Rotasi Batch Otomatis (Sequential Round-Robin):
 * - Memeriksa mode manual_frozen & override_until
 * - Memeriksa overlap: mencegah rotasi jika run sebelumnya masih 'running'
 * - Melewati (skip) batch kosong yang tidak memiliki keyword aktif
 * - Melakukan switch status batch aktif secara transaksional
 * - Memperbarui cache keyword dan mencatat log audit
 */
export async function rotateActiveKeywordBatch(
  supabase: SupabaseClient,
  options: RotateBatchOptions = {}
): Promise<RotateBatchResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const actorId = options.actorId ?? "system:cron";

  // 1. Periksa pengaturan penjadwalan saat ini
  const settings = await getBatchScheduleSettings(supabase);

  // Jika mode manual_frozen aktif dan rotasi tidak dipaksa (force), lewati rotasi
  if (settings.mode === "manual_frozen" && !options.force) {
    return {
      status: "skipped_manual_frozen",
      message: "Rotasi dilewati karena mode jadwal saat ini berstatus 'manual_frozen'.",
    };
  }

  // Jika terdapat override_until aktif yang belum kedaluwarsa
  if (settings.override_until && !options.force) {
    const overrideUntilDate = new Date(settings.override_until);
    if (now < overrideUntilDate) {
      return {
        status: "skipped_override_active",
        message: `Rotasi dilewati karena override manual masih aktif hingga ${settings.override_until}.`,
      };
    } else {
      // Override telah kedaluwarsa, kembalikan override_until ke null
      await supabase
        .from("batch_schedule_settings")
        .update({ override_until: null, mode: "auto", updated_at: nowIso })
        .eq("id", 1);
    }
  }

  // 2. Periksa Overlap Jadwal: pastikan tidak ada run yang masih 'running'
  const { data: runningRuns, error: runError } = await supabase
    .from("check_runs")
    .select("id, started_at")
    .eq("status", "running")
    .limit(1);

  if (!runError && runningRuns && runningRuns.length > 0) {
    return {
      status: "skipped_running_run",
      message: `Rotasi ditunda karena pemindaian sebelumnya masih berjalan (run_id: ${runningRuns[0].id}).`,
    };
  }

  // 3. Ambil seluruh batch beserta jumlah keyword
  const allBatches = await listKeywordBatchesWithCounts(supabase);

  // Filter batch yang diaktifkan (is_enabled = true) DAN memiliki minimal 1 keyword aktif
  // -> Menangani Edge Case: SKIP EMPTY BATCHES!
  const eligibleCandidates = allBatches
    .filter((b) => b.is_enabled && b.activeKeywords > 0)
    .sort((a, b) => a.order_index - b.order_index);

  if (eligibleCandidates.length === 0) {
    await supabase.from("batch_audit_logs").insert({
      previous_batch_id: null,
      new_batch_id: null,
      trigger_type: "warning",
      actor_id: actorId,
      notes: "Peringatan: Rotasi gagal karena tidak ada batch yang memenuhi syarat (memiliki keyword aktif dan diaktifkan).",
      created_at: nowIso,
    });

    return {
      status: "no_candidates",
      message: "Tidak ada batch yang memenuhi syarat (memiliki keyword aktif dan diaktifkan).",
    };
  }

  // 4. Cari batch yang saat ini aktif
  const currentBatch = allBatches.find((b) => b.is_active) ?? null;

  // 5. Tentukan batch berikutnya (Round-Robin berurutan)
  let nextBatch: BatchWithKeywordsCount;

  if (currentBatch) {
    // Cari kandidat dengan order_index lebih besar dari batch saat ini
    const nextCandidate = eligibleCandidates.find(
      (b) => b.order_index > currentBatch.order_index
    );

    // Jika sudah di urutan terakhir, putar kembali ke awal (wrap-around)
    nextBatch = nextCandidate ?? eligibleCandidates[0];
  } else {
    // Jika belum ada yang aktif, pilih kandidat pertama
    nextBatch = eligibleCandidates[0];
  }

  // Jika kandidat berikutnya sama dengan yang aktif sekarang (misal hanya ada 1 batch valid)
  if (currentBatch && nextBatch.id === currentBatch.id) {
    return {
      status: "rotated",
      previousBatch: currentBatch,
      newBatch: currentBatch,
      message: `Hanya ada 1 batch yang memenuhi syarat (${nextBatch.name}). Tetap pada batch aktif saat ini.`,
    };
  }

  // 6. Jalankan pergantian batch secara transaksional
  // Nonaktifkan batch aktif sebelumnya
  if (currentBatch) {
    const { error: deactivateError } = await supabase
      .from("keyword_batches")
      .update({ is_active: false, updated_at: nowIso })
      .eq("id", currentBatch.id);

    if (deactivateError) {
      throw new Error(`Gagal menonaktifkan batch sebelumnya: ${deactivateError.message}`);
    }
  }

  // Aktifkan batch baru
  const { error: activateError } = await supabase
    .from("keyword_batches")
    .update({ is_active: true, updated_at: nowIso })
    .eq("id", nextBatch.id);

  if (activateError) {
    // Upayakan pemulihan jika aktivasi gagal
    if (currentBatch) {
      await supabase
        .from("keyword_batches")
        .update({ is_active: true, updated_at: nowIso })
        .eq("id", currentBatch.id);
    }
    throw new Error(`Gagal mengaktifkan batch baru: ${activateError.message}`);
  }

  // 7. Catat audit trail pergantian batch
  await supabase.from("batch_audit_logs").insert({
    previous_batch_id: currentBatch?.id ?? null,
    new_batch_id: nextBatch.id,
    trigger_type: "auto_schedule",
    actor_id: actorId,
    notes:
      options.notes ??
      `Rotasi mingguan otomatis dari ${currentBatch?.name ?? "Tidak ada"} ke ${nextBatch.name} (order ${nextBatch.order_index}, ${nextBatch.activeKeywords} keywords aktif)`,
    created_at: nowIso,
  });

  // 8. Perbarui cache keyword (Zero-downtime)
  invalidateActiveKeywordBatchCache();

  return {
    status: "rotated",
    previousBatch: currentBatch,
    newBatch: nextBatch,
    message: `Sukses merotasi batch aktif ke ${nextBatch.name} (${nextBatch.activeKeywords} keyword aktif).`,
  };
}

/**
 * Manual Override:
 * - Admin secara manual memilih batch yang akan dijadikan aktif
 * - Opsi freezeMode untuk membekukan jadwal otomatis ('manual_frozen')
 * - Opsi overrideUntil untuk menetapkan durasi override sementara
 * - Mencatat audit trail dengan trigger_type 'admin_override'
 */
export async function overrideActiveKeywordBatch(
  supabase: SupabaseClient,
  targetBatchId: string,
  options: OverrideBatchOptions = {}
): Promise<OverrideBatchResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const actorId = options.actorId ?? "admin";

  // 1. Ambil data batch target
  const { data: targetData, error: targetError } = await supabase
    .from("keyword_batches")
    .select("*")
    .eq("id", targetBatchId)
    .single();

  if (targetError || !targetData) {
    throw new Error(`Batch tujuan tidak ditemukan: ${targetError?.message ?? targetBatchId}`);
  }

  const targetBatch = targetData as KeywordBatchRecord;
  const currentBatch = await getActiveKeywordBatch(supabase);

  // 2. Ubah batch aktif
  if (currentBatch && currentBatch.id !== targetBatchId) {
    const { error: deactError } = await supabase
      .from("keyword_batches")
      .update({ is_active: false, updated_at: nowIso })
      .eq("id", currentBatch.id);

    if (deactError) {
      throw new Error(`Gagal menonaktifkan batch aktif lama: ${deactError.message}`);
    }
  }

  const { error: actError } = await supabase
    .from("keyword_batches")
    .update({ is_active: true, updated_at: nowIso })
    .eq("id", targetBatchId);

  if (actError) {
    if (currentBatch && currentBatch.id !== targetBatchId) {
      await supabase
        .from("keyword_batches")
        .update({ is_active: true, updated_at: nowIso })
        .eq("id", currentBatch.id);
    }
    throw new Error(`Gagal mengaktifkan batch target: ${actError.message}`);
  }

  // 3. Perbarui mode schedule
  const nextMode: BatchScheduleMode = options.freezeMode ? "manual_frozen" : "auto";
  await supabase
    .from("batch_schedule_settings")
    .update({
      mode: nextMode,
      override_until: options.overrideUntil ?? null,
      updated_at: nowIso,
    })
    .eq("id", 1);

  // 4. Catat ke audit log
  await supabase.from("batch_audit_logs").insert({
    previous_batch_id: currentBatch?.id ?? null,
    new_batch_id: targetBatch.id,
    trigger_type: "admin_override",
    actor_id: actorId,
    notes:
      options.notes ??
      `Override manual ke ${targetBatch.name} (order ${targetBatch.order_index}, mode: ${nextMode})`,
    created_at: nowIso,
  });

  // 5. Invalidate cache
  invalidateActiveKeywordBatchCache();

  return {
    ok: true,
    previousBatch: currentBatch,
    newBatch: { ...targetBatch, is_active: true },
    mode: nextMode,
    message: `Batch aktif berhasil diubah secara manual ke ${targetBatch.name}.`,
  };
}
