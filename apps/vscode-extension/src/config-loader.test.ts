import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadConnectionConfig,
  resolveVscodeCandidatePaths,
} from "./config-loader";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mamep-vscode-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
});

describe("resolveVscodeCandidatePaths", () => {
  it("orders candidates by priority and dedupes", () => {
    const paths = resolveVscodeCandidatePaths({
      settingPath: "C:\\custom\\connections.json",
      workspaceRoot: "C:\\ws",
      homeDir: "C:\\users\\me",
    });
    expect(paths).toEqual([
      "C:\\custom\\connections.json",
      "C:\\ws\\config\\connections.json",
      "C:\\users\\me\\config\\connections.json",
    ]);
  });

  it("skips setting path and workspace root when absent", () => {
    const paths = resolveVscodeCandidatePaths({
      settingPath: undefined,
      workspaceRoot: null,
      homeDir: "C:\\users\\me",
    });
    expect(paths).toEqual(["C:\\users\\me\\config\\connections.json"]);
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
          { id: "tcp-a", name: "a", protocol: "tcp", host: "h", port: 502 },
        ],
      }),
      "utf8",
    );
    const result = await loadConnectionConfig([file]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.sourcePath).toBe(file);
    expect(result.value.config?.connections[0]?.protocol).toBe("tcp");
  });

  it("returns a validation failure for invalid JSON", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "connections.json");
    await writeFile(file, "{ bad", "utf8");
    const result = await loadConnectionConfig([file]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("CONNECTION_CONFIG_INVALID_JSON");
  });
});
