import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConnectionConfig, resolveCandidatePaths } from "./config-loader";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mamep-config-loader-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
});

describe("resolveCandidatePaths", () => {
  it("orders candidates by priority and dedupes", () => {
    const paths = resolveCandidatePaths({
      envPath: "C:\\custom\\connections.json",
      appRootDir: "C:\\app",
      userDataDir: "C:\\user",
    });
    expect(paths).toEqual([
      "C:\\custom\\connections.json",
      "C:\\app\\config\\connections.json",
      "C:\\user\\config\\connections.json",
    ]);
  });

  it("skips an empty env path", () => {
    const paths = resolveCandidatePaths({
      envPath: undefined,
      appRootDir: "C:\\app",
      userDataDir: "C:\\user",
    });
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe("C:\\app\\config\\connections.json");
  });
});

describe("loadConnectionConfig", () => {
  it("returns ok(config:null) when no candidate exists", async () => {
    const dir = await makeTempDir();
    const result = await loadConnectionConfig([
      path.join(dir, "missing.json"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.config).toBeNull();
    expect(result.value.sourcePath).toBeNull();
  });

  it("loads and parses the first existing candidate", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "connections.json");
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        connections: [
          { id: "rtu-com4", name: "COM4", protocol: "rtu", port: "COM4" },
        ],
      }),
      "utf8",
    );
    const result = await loadConnectionConfig([file]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.sourcePath).toBe(file);
    expect(result.value.config?.connections[0]?.id).toBe("rtu-com4");
  });

  it("returns a load failure for an unreadable candidate", async () => {
    const dir = await makeTempDir();
    // 指向一个目录而非文件：readFile 会失败。
    const result = await loadConnectionConfig([dir]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("CONNECTION_CONFIG_LOAD_FAILED");
  });

  it("returns a validation failure for invalid JSON", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "connections.json");
    await writeFile(file, "{ not json", "utf8");
    const result = await loadConnectionConfig([file]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("CONNECTION_CONFIG_INVALID_JSON");
  });

  it("stops at the first existing candidate (priority order)", async () => {
    const dir = await makeTempDir();
    const first = path.join(dir, "first.json");
    const second = path.join(dir, "second.json");
    await writeFile(
      first,
      JSON.stringify({
        schemaVersion: 1,
        connections: [{ id: "a", name: "a", protocol: "tcp", host: "h", port: 502 }],
      }),
      "utf8",
    );
    // second 存在但内容非法——不应被读取（first 已命中）。
    await writeFile(second, "{ bad", "utf8");
    const result = await loadConnectionConfig([first, second]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.sourcePath).toBe(first);
  });
});
