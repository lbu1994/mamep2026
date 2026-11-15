/**
 * PluginFileStore 单测。
 * 注入临时目录（os.tmpdir + mkdtemp），覆盖：roundtrip、原子替换与 .bak 轮转、损坏恢复
 * （自愈写回）、双坏错误、无文件空存储、非法数据拒绝落盘、错误映射（category plugin）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyPluginStoreData } from "@mamep2026/plugin-api";
import type { PluginManifest, PluginStoreData } from "@mamep2026/plugin-api";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PluginFileStore } from "./plugin-file-store";

const MAIN_FILE = "plugins.json";
const BACKUP_FILE = "plugins.json.bak";

const manifest: PluginManifest = {
  id: "installed-a",
  name: "Installed A",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "A user-installed plugin",
  requiredCapabilities: [],
  platform: { web: true, node: false },
  permissions: ["ui-contribution"],
  contributes: { panels: [] },
};

function storeData(name: string): PluginStoreData {
  return {
    schemaVersion: 4,
    plugins: [{ manifest: { ...manifest, id: name, name }, enabled: true }],
  };
}

let dirs: string[] = [];

async function makeRepo(): Promise<{ repo: PluginFileStore; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "mamep-plugin-store-"));
  dirs.push(dir);
  return { repo: new PluginFileStore(dir), dir };
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

afterEach(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  dirs = [];
});

describe("PluginFileStore", () => {
  it("首次 load（无文件）返回空插件存储", async () => {
    const { repo } = await makeRepo();
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(createEmptyPluginStoreData());
    }
  });

  it("save 后 load 往返一致（roundtrip）", async () => {
    const { repo, dir } = await makeRepo();
    const data = storeData("installed-a");
    const saved = await repo.save(data);
    expect(saved.ok).toBe(true);
    const loaded = await repo.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toEqual(data);
    }
    const content = await readIfExists(path.join(dir, MAIN_FILE));
    expect(content).toBe(JSON.stringify(data));
  });

  it("第二次 save 轮转生成 .bak（内容=上一次主文件）", async () => {
    const { repo, dir } = await makeRepo();
    const d1 = storeData("first");
    const d2 = storeData("second");
    await repo.save(d1);
    await repo.save(d2);
    const mainContent = await readIfExists(path.join(dir, MAIN_FILE));
    const backupContent = await readIfExists(path.join(dir, BACKUP_FILE));
    expect(mainContent).toBe(JSON.stringify(d2));
    expect(backupContent).toBe(JSON.stringify(d1));
  });

  it("主文件损坏时从备份恢复并自愈写回", async () => {
    const { repo, dir } = await makeRepo();
    const d1 = storeData("first");
    const d2 = storeData("second");
    await repo.save(d1);
    // 第二次 save 轮转出 .bak（内容 = d1）。
    await repo.save(d2);
    // 主文件写入非法内容（模拟损坏）。
    await writeFile(path.join(dir, MAIN_FILE), "{ not-json", "utf8");

    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(d1);
    }
    // 自愈：主文件被备份内容覆盖。
    const mainContent = await readIfExists(path.join(dir, MAIN_FILE));
    expect(mainContent).toBe(JSON.stringify(d1));
  });

  it("主文件与备份皆损坏时返回结构化错误（category plugin）", async () => {
    const { repo, dir } = await makeRepo();
    const data = storeData("installed-a");
    await repo.save(data);
    await writeFile(path.join(dir, MAIN_FILE), "{ not-json", "utf8");
    await writeFile(path.join(dir, BACKUP_FILE), "not-json-either", "utf8");

    const result = await repo.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_STORE_SCHEMA_INVALID");
      expect(result.error.category).toBe("plugin");
    }
  });

  it("非法数据（schema 不合法）拒绝落盘", async () => {
    const { repo } = await makeRepo();
    const result = await repo.save({
      schemaVersion: 1,
      plugins: [{ manifest: { id: "x" }, enabled: true }],
    } as unknown as PluginStoreData);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_STORE_SCHEMA_INVALID");
    }
  });

  it("IO 失败映射为 PLUGIN_STORE_WRITE_FAILED（category plugin）", async () => {
    // 目录不存在（父目录被删）→ writeAtomic 抛错 → 映射为写入失败。
    const dir = await mkdtemp(path.join(tmpdir(), "mamep-plugin-store-"));
    dirs.push(dir);
    const repo = new PluginFileStore(path.join(dir, "missing-sub"));
    const result = await repo.save(storeData("installed-a"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_STORE_WRITE_FAILED");
      expect(result.error.category).toBe("plugin");
    }
  });
});
