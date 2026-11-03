import type { SupabaseClient } from "@supabase/supabase-js";

export type BatchScheduleMode = "auto" | "manual_frozen";

export interface KeywordBatchRecord {
  id: string;
  name: string;
  description: string | null;
  color?: string | null;
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
  max_runs_per_month?: number;
  override_until: string | null;
  updated_at: string;
}

export interface BatchScheduleSlotRecord {
  id: string;
  week_number: number; // 1 to 4
  batch_id: string | null;
  is_override: boolean;
  created_at: string;
  updated_at: string;
}

export interface BatchScheduleSlotWithBatch extends BatchScheduleSlotRecord {
  batch: KeywordBatchRecord | null;
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
  useSlotSchedule?: boolean;
  enforceMonthlyLimit?: boolean;
}

export type RotateBatchStatus =
  | "rotated"
  | "skipped_manual_frozen"
  | "skipped_override_active"
  | "skipped_running_run"
  | "skipped_monthly_limit"
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
  if (options.useSlotSchedule) {
    return rotateActiveBatchBySlot(supabase, options);
  }

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

  // Filter batch yang diaktifkan (is_enabled = true)
  const enabledBatches = allBatches
    .filter((b) => b.is_enabled)
    .sort((a, b) => a.order_index - b.order_index);

  if (enabledBatches.length === 0) {
    await supabase.from("batch_audit_logs").insert({
      previous_batch_id: null,
      new_batch_id: null,
      trigger_type: "warning",
      actor_id: actorId,
      notes: "Peringatan: Rotasi gagal karena tidak ada batch yang diaktifkan (is_enabled = true).",
      created_at: nowIso,
    });

    return {
      status: "no_candidates",
      message: "Tidak ada batch yang diaktifkan (is_enabled = true).",
    };
  }

  // 4. Cari batch yang saat ini aktif
  const currentBatch = allBatches.find((b) => b.is_active) ?? null;

  // 5. Tentukan batch berikutnya (Round-Robin berurutan)
  let candidateIndex = 0;
  if (currentBatch) {
    const nextIdx = enabledBatches.findIndex(
      (b) => b.order_index > currentBatch.order_index
    );
    candidateIndex = nextIdx !== -1 ? nextIdx : 0; // Wrap around ke batch pertama jika sudah di akhir
  }

  let nextBatch = enabledBatches[candidateIndex]!;

  // 5b. Deteksi & Penanganan Batch Kosong (0 active keywords)
  if (nextBatch.activeKeywords === 0) {
    const candidatesWithKeywords = enabledBatches.filter((b) => b.activeKeywords > 0);

    if (candidatesWithKeywords.length === 0) {
      await supabase.from("batch_audit_logs").insert({
        previous_batch_id: currentBatch?.id ?? null,
        new_batch_id: null,
        trigger_type: "warning",
        actor_id: actorId,
        notes: "Peringatan: Seluruh batch yang aktif memiliki 0 keyword. Tidak ada batch yang dapat diaktifkan.",
        created_at: nowIso,
      });

      return {
        status: "no_candidates",
        message: "Seluruh batch yang diaktifkan kosong (0 keyword aktif).",
      };
    }

    // Ada kandidat lain yang memiliki keyword, catat log audit peringatan untuk batch yang dilewati
    await supabase.from("batch_audit_logs").insert({
      previous_batch_id: currentBatch?.id ?? null,
      new_batch_id: nextBatch.id,
      trigger_type: "empty_batch_warning",
      actor_id: actorId,
      notes: `Notifikasi: Batch '${nextBatch.name}' memiliki 0 keyword aktif. Rotasi otomatis melompati batch ini ke batch berikutnya yang valid.`,
      created_at: nowIso,
    });

    const altCandidate = candidatesWithKeywords.find(
      (b) => (currentBatch ? b.order_index > currentBatch.order_index : true)
    );
    nextBatch = altCandidate ?? candidatesWithKeywords[0]!;
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

  const mondayInfo = getMondayOccurrenceOfMonth(now);

  // 7. Catat audit trail pergantian batch
  await supabase.from("batch_audit_logs").insert({
    previous_batch_id: currentBatch?.id ?? null,
    new_batch_id: nextBatch.id,
    trigger_type: "auto_schedule",
    actor_id: actorId,
    notes:
      options.notes ??
      `Rotasi mingguan otomatis (${mondayInfo.formattedWib}): ${currentBatch?.name ?? "Tidak ada"} -> ${nextBatch.name} (order ${nextBatch.order_index}, ${nextBatch.activeKeywords} keywords aktif)`,
    created_at: nowIso,
  });

  // 8. Sinkronkan slot minggu kalender saat ini agar selaras (jika slot bukan override)
  const currentWeek = getSlotWeekNumber(now);
  try {
    await supabase
      .from("batch_schedule_slots")
      .update({ batch_id: nextBatch.id, updated_at: nowIso })
      .eq("week_number", currentWeek)
      .eq("is_override", false);
  } catch {
    // Non-blocking
  }

  // 9. Perbarui cache keyword (Zero-downtime)
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

/**
 * Menghitung daftar tanggal hari Senin dalam bulan dan tahun tertentu.
 */
export function getMondaysInMonth(year: number, month: number): number[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const mondays: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const cur = new Date(year, month, d);
    if (cur.getDay() === 1) {
      // 1 = Senin
      mondays.push(d);
    }
  }
  return mondays;
}

/**
 * Menghitung minggu aktif dalam bulan berdasarkan hari SENIN sebagai titik awal siklus:
 * - Siklus resmi bulan berjalan dimulai pada hari Senin pertama di bulan tersebut (Week 1).
 * - Setiap minggu berjalan utuh dari Senin s/d Minggu (Monday through Sunday).
 * - Tanggal sebelum Senin pertama (jika ada, misal tgl 1 Nov 2026 yang jatuh pada hari Minggu)
 *   merupakan pra-siklus (mengembalikan 0).
 * - Hari Senin ke-1 s/d Minggu berikutnya adalah Week 1.
 * - Hari Senin ke-2 s/d Minggu berikutnya adalah Week 2, dst.
 */
export function getActiveWeekOfMonth(date: Date = new Date()): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const mondays = getMondaysInMonth(year, month);

  if (mondays.length === 0) return 1;

  const firstMonday = mondays[0]!;

  // Jika tanggal berada sebelum hari Senin pertama di bulan berjalan (pra-siklus):
  if (day < firstMonday) {
    return 0;
  }

  for (let i = 0; i < mondays.length; i++) {
    const startMon = mondays[i]!;
    const nextMon = mondays[i + 1];
    if (nextMon !== undefined) {
      if (day >= startMon && day < nextMon) {
        return i + 1; // 1, 2, 3, 4
      }
    } else {
      if (day >= startMon) {
        return i + 1; // 4 atau 5
      }
    }
  }

  return 1;
}

/**
 * Memetakan nomor minggu aktif ke slot database 1 s/d 4.
 * - Week 0 (hari sebelum Senin pertama) mengarah ke Slot 4 (siklus sebelumnya).
 * - Week 1..4 mengarah ke Slot 1..4.
 * - Week 5 (Senin ke-5) mengarah ke Slot 1 (wrap-around siklus baru).
 */
export function getSlotWeekNumber(date: Date = new Date()): number {
  const week = getActiveWeekOfMonth(date);
  if (week === 0) return 4;
  if (week > 4) return ((week - 1) % 4) + 1;
  return week;
}

export interface MondayOccurrenceInfo {
  occurrence: number; // 1 s/d 5 (Senin keberapa dalam bulan ini)
  totalMondays: number; // 4 atau 5 (Total hari Senin di bulan ini)
  isMonday: boolean;
  label: string; // e.g., "Monday #1 of November 2026"
  formattedWib: string; // e.g., "Senin ke-1 (November 2026)"
}

/**
 * Mendeteksi kemunculan hari Senin keberapa dalam bulan kalender berjalan (1 s/d 5).
 * Memudahkan monitoring dan audit log mingguan.
 */
export function getMondayOccurrenceOfMonth(date: Date = new Date()): MondayOccurrenceInfo {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const isMonday = date.getDay() === 1;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let totalMondays = 0;
  let occurrence = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const cur = new Date(year, month, d);
    if (cur.getDay() === 1) {
      totalMondays++;
      if (d <= day) {
        occurrence++;
      }
    }
  }

  if (occurrence === 0) {
    occurrence = 1;
  }

  const MONTH_NAMES_EN = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const MONTH_NAMES_ID = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  const monthEn = MONTH_NAMES_EN[month] ?? "Current Month";
  const monthId = MONTH_NAMES_ID[month] ?? "Bulan Ini";

  const label = isMonday
    ? `Monday #${occurrence} of ${monthEn} ${year}`
    : `Week #${occurrence} (${monthEn} ${year})`;

  const formattedWib = isMonday
    ? `Senin ke-${occurrence} (${monthId} ${year})`
    : `Minggu ke-${occurrence} (${monthId} ${year})`;

  return {
    occurrence,
    totalMondays,
    isMonday,
    label,
    formattedWib,
  };
}

/**
 * Menghitung jumlah pemindaian non-demo yang telah dieksekusi dalam bulan kalender berjalan.
 */
export async function getMonthlyRunCount(
  supabase: SupabaseClient,
  date: Date = new Date()
): Promise<number> {
  const year = date.getFullYear();
  const month = date.getMonth();
  const startOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0)).toISOString();
  const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString();

  const { data, error } = await supabase
    .from("check_runs")
    .select("id")
    .eq("is_demo", false)
    .gte("started_at", startOfMonth)
    .lte("started_at", endOfMonth);

  if (error || !data) {
    return 0;
  }

  return data.length;
}

/**
 * Mengambil daftar 4 slot jadwal bulanan (Week 1 s/d Week 4) beserta data entitas batch terkait.
 */
export async function getBatchScheduleSlots(
  supabase: SupabaseClient
): Promise<BatchScheduleSlotWithBatch[]> {
  const { data, error } = await supabase
    .from("batch_schedule_slots")
    .select("id, week_number, batch_id, is_override, created_at, updated_at")
    .order("week_number", { ascending: true });

  if (error) {
    throw new Error(`Gagal membaca slot jadwal batch: ${error.message}`);
  }

  const rawSlots = (data as BatchScheduleSlotRecord[]) ?? [];
  if (rawSlots.length < 4) {
    // Jika belum lengkap 4 slot, jalankan sinkronisasi slot default
    await syncDefaultScheduleSlots(supabase);
    const { data: syncedData } = await supabase
      .from("batch_schedule_slots")
      .select("id, week_number, batch_id, is_override, created_at, updated_at")
      .order("week_number", { ascending: true });
    return joinSlotsWithBatches(supabase, (syncedData as BatchScheduleSlotRecord[]) ?? []);
  }

  return joinSlotsWithBatches(supabase, rawSlots);
}

async function joinSlotsWithBatches(
  supabase: SupabaseClient,
  slots: BatchScheduleSlotRecord[]
): Promise<BatchScheduleSlotWithBatch[]> {
  const batches = await listKeywordBatches(supabase);
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  return slots.map((s) => ({
    ...s,
    batch: s.batch_id ? batchMap.get(s.batch_id) ?? null : null,
  }));
}

/**
 * Menyinkronkan 4 slot jadwal sesuai aturan rotasi otomatis:
 * - Jika jumlah batch < 4: ulangi dari batch pertama setelah habis (round-robin / modulo).
 * - Jika jumlah batch >= 4: gunakan 4 batch pertama secara berurutan.
 * - Slot dengan is_override = true tidak akan diubah kecuali batch terkait sudah dihapus.
 */
export async function syncDefaultScheduleSlots(
  supabase: SupabaseClient
): Promise<BatchScheduleSlotRecord[]> {
  const batches = await listKeywordBatches(supabase);
  const enabledBatches = batches
    .filter((b) => b.is_enabled)
    .sort((a, b) => a.order_index - b.order_index);

  const { data: existingSlots } = await supabase
    .from("batch_schedule_slots")
    .select("id, week_number, batch_id, is_override")
    .order("week_number", { ascending: true });

  const existingMap = new Map<number, { id: string; week_number: number; batch_id: string | null; is_override: boolean }>();
  for (const s of (existingSlots ?? []) as Array<{ id: string; week_number: number; batch_id: string | null; is_override: boolean }>) {
    existingMap.set(s.week_number, s);
  }

  const N = enabledBatches.length;
  const nowIso = new Date().toISOString();
  const updatedSlots: BatchScheduleSlotRecord[] = [];

  for (let w = 1; w <= 4; w++) {
    const existing = existingMap.get(w);

    // Jika slot memiliki override manual dan batch-nya masih valid di database, pertahankan override tersebut
    if (existing && existing.is_override && existing.batch_id) {
      const stillExists = batches.some((b) => b.id === existing.batch_id);
      if (stillExists) {
        continue;
      }
    }

    // Aturan rotasi: (w - 1) % N
    const targetBatchId = N === 0 ? null : enabledBatches[(w - 1) % N]!.id;

    if (existing) {
      const { data: updated } = await supabase
        .from("batch_schedule_slots")
        .update({
          batch_id: targetBatchId,
          is_override: false,
          updated_at: nowIso,
        })
        .eq("week_number", w)
        .select()
        .single();
      if (updated) updatedSlots.push(updated as BatchScheduleSlotRecord);
    } else {
      const { data: inserted } = await supabase
        .from("batch_schedule_slots")
        .insert({
          week_number: w,
          batch_id: targetBatchId,
          is_override: false,
          updated_at: nowIso,
        })
        .select()
        .single();
      if (inserted) updatedSlots.push(inserted as BatchScheduleSlotRecord);
    }
  }

  return updatedSlots;
}

/**
 * Menugaskan batch tertentu ke slot minggu tertentu (Week 1 s/d 4).
 * Opsi isOverride menandai slot ini sebagai override kustom manual.
 */
export async function assignBatchToSlot(
  supabase: SupabaseClient,
  weekNumber: number,
  batchId: string | null,
  isOverride = true,
  actorId = "admin"
): Promise<{ ok: boolean; message: string }> {
  if (weekNumber < 1 || weekNumber > 4) {
    throw new Error(`Nomor minggu slot harus antara 1 dan 4 (diterima: ${weekNumber})`);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  let targetBatch: KeywordBatchRecord | null = null;

  if (batchId) {
    const { data, error } = await supabase
      .from("keyword_batches")
      .select("*")
      .eq("id", batchId)
      .single();

    if (error || !data) {
      throw new Error(`Batch dengan id ${batchId} tidak ditemukan.`);
    }
    targetBatch = data as KeywordBatchRecord;
  }

  const { error: slotError } = await supabase
    .from("batch_schedule_slots")
    .update({
      batch_id: batchId,
      is_override: isOverride,
      updated_at: nowIso,
    })
    .eq("week_number", weekNumber);

  if (slotError) {
    throw new Error(`Gagal memperbarui slot minggu ke-${weekNumber}: ${slotError.message}`);
  }

  // Catat riwayat audit
  await supabase.from("batch_audit_logs").insert({
    previous_batch_id: null,
    new_batch_id: batchId,
    trigger_type: "slot_assignment",
    actor_id: actorId,
    notes: `Slot Week ${weekNumber} ditugaskan ke ${targetBatch ? targetBatch.name : "Unassigned"} (override: ${isOverride})`,
    created_at: nowIso,
  });

  // Jika minggu ini sedang berjalan dan mode jadwal 'auto', langsung sinkronkan batch aktif
  const currentWeek = getSlotWeekNumber(now);
  const settings = await getBatchScheduleSettings(supabase).catch(() => null);
  if (currentWeek === weekNumber && targetBatch && settings?.mode !== "manual_frozen") {
    await overrideActiveKeywordBatch(supabase, targetBatch.id, {
      actorId,
      freezeMode: false,
      notes: `Otomatis mengaktifkan ${targetBatch.name} sesuai penugasan slot Week ${weekNumber}`,
      now,
    });
  }

  invalidateActiveKeywordBatchCache();
  return {
    ok: true,
    message: `Slot Week ${weekNumber} berhasil ditugaskan ke ${targetBatch ? targetBatch.name : "Unassigned"}.`,
  };
}

/**
 * Mereset seluruh 4 slot rotasi bulanan ke pola bawaan (menghapus tanda override).
 */
export async function resetSlotsToDefault(
  supabase: SupabaseClient,
  actorId = "admin"
): Promise<{ ok: boolean; message: string }> {
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("batch_schedule_slots")
    .update({ is_override: false, updated_at: nowIso })
    .gte("week_number", 1)
    .lte("week_number", 4);

  if (error) {
    throw new Error(`Gagal mereset slot jadwal: ${error.message}`);
  }

  await syncDefaultScheduleSlots(supabase);

  await supabase.from("batch_audit_logs").insert({
    previous_batch_id: null,
    new_batch_id: null,
    trigger_type: "slots_reset",
    actor_id: actorId,
    notes: "Mereset seluruh 4 slot rotasi bulanan ke pola bawaan",
    created_at: nowIso,
  });

  return {
    ok: true,
    message: "Seluruh 4 slot rotasi bulanan berhasil direset ke pola bawaan.",
  };
}

/**
 * Rotasi Batch Berbasis Slot Mingguan (Weekly Slot Rotation):
 * - Memastikan batas maksimal eksekusi cron per bulan kalender (max_runs_per_month, default 4).
 * - Menentukan minggu aktif dalam bulan (Week 1 s/d 4) via getActiveWeekOfMonth.
 * - Mengambil batch yang ditugaskan pada slot minggu tersebut.
 * - Mengaktifkan batch tersebut secara atomik dan mencatat audit trail.
 */
export async function rotateActiveBatchBySlot(
  supabase: SupabaseClient,
  options: RotateBatchOptions = {}
): Promise<RotateBatchResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const actorId = options.actorId ?? "system:cron";

  // 1. Periksa pengaturan penjadwalan
  const settings = await getBatchScheduleSettings(supabase);

  if (settings.mode === "manual_frozen" && !options.force) {
    return {
      status: "skipped_manual_frozen",
      message: "Rotasi slot dilewati karena mode jadwal saat ini berstatus 'manual_frozen'.",
    };
  }

  if (settings.override_until && !options.force) {
    const overrideUntilDate = new Date(settings.override_until);
    if (now < overrideUntilDate) {
      return {
        status: "skipped_override_active",
        message: `Rotasi slot dilewati karena override manual masih aktif hingga ${settings.override_until}.`,
      };
    } else {
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
      message: `Rotasi slot ditunda karena pemindaian sebelumnya masih berjalan (run_id: ${runningRuns[0].id}).`,
    };
  }

  // 3. Batas Maksimal Eksekusi per Bulan Kalender (Jika enforceMonthlyLimit tidak bernilai false)
  const shouldEnforceLimit = options.enforceMonthlyLimit ?? (settings.max_runs_per_month !== undefined && settings.max_runs_per_month !== null);
  if (shouldEnforceLimit && !options.force) {
    const maxRuns = settings.max_runs_per_month ?? 4;
    const monthlyRuns = await getMonthlyRunCount(supabase, now);

    if (monthlyRuns >= maxRuns) {
      return {
        status: "skipped_monthly_limit",
        message: `Batas maksimal rotasi/eksekusi per bulan (${monthlyRuns}/${maxRuns} run) telah tercapai untuk bulan ini.`,
      };
    }
  }

  // 4. Cari slot untuk minggu kalender saat ini
  const currentWeek = getSlotWeekNumber(now);
  let slots = await getBatchScheduleSlots(supabase);
  let currentSlot = slots.find((s) => s.week_number === currentWeek);

  // Jika slot belum memiliki batch atau batch-nya dinonaktifkan, lakukan sinkronisasi default
  if (!currentSlot?.batch || !currentSlot.batch.is_enabled) {
    await syncDefaultScheduleSlots(supabase);
    slots = await getBatchScheduleSlots(supabase);
    currentSlot = slots.find((s) => s.week_number === currentWeek);
  }

  const targetBatch = currentSlot?.batch ?? null;
  if (!targetBatch || !targetBatch.is_enabled) {
    await supabase.from("batch_audit_logs").insert({
      previous_batch_id: null,
      new_batch_id: null,
      trigger_type: "warning",
      actor_id: actorId,
      notes: `Peringatan: Tidak ada batch yang valid untuk jadwal slot Week ${currentWeek}.`,
      created_at: nowIso,
    });

    return {
      status: "no_candidates",
      message: `Tidak ada batch yang valid untuk jadwal slot Week ${currentWeek}.`,
    };
  }

  const currentActiveBatch = await getActiveKeywordBatch(supabase);

  // Jika batch yang ditargetkan sudah aktif
  if (currentActiveBatch && currentActiveBatch.id === targetBatch.id) {
    return {
      status: "rotated",
      previousBatch: currentActiveBatch,
      newBatch: targetBatch,
      message: `Batch aktif saat ini (${targetBatch.name}) sudah sesuai dengan slot jadwal Week ${currentWeek}.`,
    };
  }

  // Nonaktifkan batch aktif lama
  if (currentActiveBatch) {
    await supabase
      .from("keyword_batches")
      .update({ is_active: false, updated_at: nowIso })
      .eq("id", currentActiveBatch.id);
  }

  // Aktifkan batch slot target
  const { error: activateError } = await supabase
    .from("keyword_batches")
    .update({ is_active: true, updated_at: nowIso })
    .eq("id", targetBatch.id);

  if (activateError) {
    if (currentActiveBatch) {
      await supabase
        .from("keyword_batches")
        .update({ is_active: true, updated_at: nowIso })
        .eq("id", currentActiveBatch.id);
    }
    throw new Error(`Gagal mengaktifkan batch slot: ${activateError.message}`);
  }

  const mondayInfo = getMondayOccurrenceOfMonth(now);

  // Catat log audit
  await supabase.from("batch_audit_logs").insert({
    previous_batch_id: currentActiveBatch?.id ?? null,
    new_batch_id: targetBatch.id,
    trigger_type: "weekly_slot_rotation",
    actor_id: actorId,
    notes:
      options.notes ??
      `Rotasi slot mingguan (${mondayInfo.formattedWib}): Berpindah ke ${targetBatch.name} (order ${targetBatch.order_index})`,
    created_at: nowIso,
  });

  invalidateActiveKeywordBatchCache();

  return {
    status: "rotated",
    previousBatch: currentActiveBatch,
    newBatch: targetBatch,
    message: `Sukses merotasi batch aktif ke ${targetBatch.name} sesuai slot Week ${currentWeek}.`,
  };
}
