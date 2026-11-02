import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, it, expect } from "vitest";

describe("Requirement 6: Skrip tsx dan Pemuatan Modul", () => {
  it("memastikan semua skrip di package.json memakai tsx dan bukan node", () => {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    expect(pkg.devDependencies).toHaveProperty("tsx");
    expect(pkg.type).toBeUndefined(); // Jangan menambahkan "type": "module"

    const scriptKeys = [
      "check:env",
      "verify:db",
      "try:keyword",
      "try:fetch",
      "try:dry-run",
      "seed:demo",
      "seed:clear",
    ];

    for (const key of scriptKeys) {
      const scriptCmd = pkg.scripts[key];
      expect(scriptCmd).toBeDefined();
      expect(scriptCmd).toMatch(/^tsx\s+scripts\//);
      expect(scriptCmd).not.toMatch(/^node\s+scripts\//);
    }
  });

  it("memastikan skrip try-keyword dapat memuat modul dan berjalan via tsx seperti npm run", () => {
    const stdout = execSync(
      'npx tsx scripts/try-keyword.ts --dry-run "linovhr"',
      {
        cwd: process.cwd(),
        encoding: "utf-8",
      }
    );

    const lines = stdout.trim().split(/\r?\n/);
    expect(lines[0]).toBe("MODE: DRY RUN (fixture, no network)");
    expect(stdout).toContain("Jumlah panggilan SerpApi");
    expect(stdout).toContain("Daftar domain unik");
    expect(stdout).toContain("LinovHR");
  }, 30000);

  it("memastikan mode replay try-keyword membaca fixture tanpa jaringan dan mencetak laporan identik", () => {
    // 1. Fixture software-hr-terbaik.json
    const stdout1 = execSync(
      "npx tsx scripts/try-keyword.ts --replay tests/fixtures/software-hr-terbaik.json",
      {
        cwd: process.cwd(),
        encoding: "utf-8",
      }
    );

    const lines1 = stdout1.trim().split(/\r?\n/);
    expect(lines1[0]).toBe("MODE: REPLAY (fixture, no network)");
    expect(stdout1).toContain("Jumlah panggilan SerpApi       : 0");
    expect(stdout1).toContain("Tingkat resolusi sumber        : 7/7 (100%)");
    expect(stdout1).toContain("www.linovhr.com");
    expect(stdout1).toContain("www.talenta.co");
    expect(stdout1).toContain("LinovHR");

    // 2. Fixture cara-hitung-pph-21-karyawan.json
    const stdout2 = execSync(
      "npx tsx scripts/try-keyword.ts --replay tests/fixtures/cara-hitung-pph-21-karyawan.json",
      {
        cwd: process.cwd(),
        encoding: "utf-8",
      }
    );

    const lines2 = stdout2.trim().split(/\r?\n/);
    expect(lines2[0]).toBe("MODE: REPLAY (fixture, no network)");
    expect(stdout2).toContain("Jumlah panggilan SerpApi       : 0");
    expect(stdout2).toContain("Tingkat resolusi sumber        : 11/12 (92%)");
    expect(stdout2).toContain("ortax.org");
    expect(stdout2).toContain("kalkulator.pajak.go.id");
  }, 30000);
});
