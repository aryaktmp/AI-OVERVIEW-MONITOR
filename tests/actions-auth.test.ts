import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  addBrandTermAction,
  addCompetitorAction,
  addKeywordAction,
  addKeywordGroupAction,
  clearDemoDataAction,
  deleteBrandTermAction,
  deleteCompetitorAction,
  deleteKeywordAction,
  deleteKeywordGroupAction,
  importKeywordsCsvAction,
  processRunBatchAction,
  runCheckNowAction,
  saveSearchSettingsAction,
  toggleBrandTermAction,
  toggleKeywordActiveAction,
} from "@/app/(dashboard)/actions";

describe("Otorisasi Server Actions (app/(dashboard)/actions.ts)", () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = "admin@linovhr.com,seo@linovhr.com";
    mockGetUser.mockReset();
  });

  const sampleUuid = "550e8400-e29b-41d4-a716-446655440000";

  function buildAllActionCalls() {
    const fd = new FormData();
    fd.set("text", "software hr");
    fd.set("name", "Produk HR");
    fd.set("term", "LinovHR");
    fd.set("domain", "talenta.co");
    fd.set("csvText", "keyword,group\nsoftware hr,Produk HR");
    fd.set("location", "Indonesia");
    fd.set("google_domain", "google.co.id");
    fd.set("gl", "id");
    fd.set("hl", "id");

    return [
      () => addKeywordAction(fd),
      () => importKeywordsCsvAction(fd),
      () => toggleKeywordActiveAction(sampleUuid, false),
      () => deleteKeywordAction(sampleUuid),
      () => addKeywordGroupAction(fd),
      () => deleteKeywordGroupAction(sampleUuid),
      () => addBrandTermAction(fd),
      () => toggleBrandTermAction(sampleUuid, false),
      () => deleteBrandTermAction(sampleUuid),
      () => addCompetitorAction(fd),
      () => deleteCompetitorAction(sampleUuid),
      () => saveSearchSettingsAction(fd),
      () => runCheckNowAction(),
      () => processRunBatchAction(sampleUuid),
      () => clearDemoDataAction(),
    ];
  }

  it("menolak semua server action jika pengguna belum login (tanpa sesi)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    for (const invokeAction of buildAllActionCalls()) {
      await expect(invokeAction()).rejects.toThrow(/Akses ditolak/i);
    }
  });

  it("menolak semua server action jika email pengguna berada di luar ALLOWED_EMAILS", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "stranger@gmail.com" } },
    });

    for (const invokeAction of buildAllActionCalls()) {
      await expect(invokeAction()).rejects.toThrow(/Akses ditolak/i);
    }
  });
});
