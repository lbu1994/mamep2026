import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  auditWorkspaceBoundaries,
  extractModuleReferences,
  findPlatformBoundaryViolation,
  findRuntimeDependencyCycles,
  parsePackageSpecifier,
} from "./workspace-boundary-audit.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("workspace boundary audit", () => {
  it("current workspace manifests and platform boundaries pass", () => {
    const result = auditWorkspaceBoundaries(ROOT);
    assert.deepEqual(
      result.violations,
      [],
      result.violations
        .map(
          (violation) =>
            `${violation.code} ${violation.packageName} ${violation.file}: ${violation.message}`,
        )
        .join("\n"),
    );
  });

  it("extracts static, dynamic, type-only and CommonJS references", () => {
    const references = extractModuleReferences(
      "fixture.ts",
      [
        'import type { A } from "type-only";',
        'import { value } from "value";',
        'export * from "re-export";',
        'const lazy = import("lazy");',
        'const legacy = require("legacy");',
        'type Imported = import("import-type").Value;',
      ].join("\n"),
    );
    assert.deepEqual(
      references.map(({ specifier, typeOnly }) => [specifier, typeOnly]),
      [
        ["type-only", true],
        ["value", false],
        ["re-export", false],
        ["lazy", false],
        ["legacy", false],
        ["import-type", true],
      ],
    );
  });

  it("reports missing, dev-only and unused runtime dependencies", async () => {
    const fixtureRoot = await mkdtemp(
      path.join(tmpdir(), "mamep-boundary-audit-"),
    );
    try {
      const packageRoot = path.join(fixtureRoot, "packages", "app");
      await mkdir(path.join(packageRoot, "src"), { recursive: true });
      await mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "package.json"),
        JSON.stringify({ name: "fixture-root", private: true }),
      );
      await writeFile(
        path.join(fixtureRoot, "pnpm-workspace.yaml"),
        'packages:\n  - "packages/*"\n',
      );
      await writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify({
          name: "@mamep2026/fixture-app",
          dependencies: { unused: "1.0.0" },
          devDependencies: { "dev-only": "1.0.0" },
        }),
      );
      await writeFile(
        path.join(packageRoot, "src", "index.ts"),
        [
          'import "undeclared";',
          'import "dev-only";',
          "export const value = 1;",
        ].join("\n"),
      );
      await writeFile(
        path.join(fixtureRoot, "scripts", "tool.mjs"),
        'import "tooling-only";\n',
      );

      const result = auditWorkspaceBoundaries(fixtureRoot);
      assert.deepEqual(
        result.violations
          .filter((violation) => violation.code === "MISSING_DEPENDENCY")
          .map((violation) => violation.specifier)
          .sort(),
        ["tooling-only", "undeclared"],
      );
      assert.deepEqual(
        result.violations
          .filter((violation) => violation.code !== "MISSING_DEPENDENCY")
          .map((violation) => violation.code)
          .sort(),
        ["RUNTIME_DEV_DEPENDENCY", "UNUSED_RUNTIME_DEPENDENCY"],
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("parses scoped package subpaths", () => {
    assert.deepEqual(
      parsePackageSpecifier("@mamep2026/platform-android/capacitor-app"),
      {
        packageName: "@mamep2026/platform-android",
        subpath: "capacitor-app",
      },
    );
  });

  it("detects runtime workspace cycles", () => {
    const cycles = findRuntimeDependencyCycles(
      new Map([
        ["a", ["b"]],
        ["b", ["c"]],
        ["c", ["a"]],
        ["d", []],
      ]),
    );
    assert.deepEqual(cycles, [["a", "b", "c", "a"]]);
  });

  it("rejects Node and host API imports from platform-agnostic layers", () => {
    assert.equal(
      findPlatformBoundaryViolation({
        packageName: "@mamep2026/ui",
        relativePath: "src/example.ts",
        specifier: "electron",
      })?.code,
      "PLATFORM_BOUNDARY_VIOLATION",
    );
    assert.equal(
      findPlatformBoundaryViolation({
        packageName: "@mamep2026/domain",
        relativePath: "src/example.ts",
        specifier: "node:fs",
      })?.code,
      "PLATFORM_BOUNDARY_VIOLATION",
    );
  });

  it("allows documented host boundaries and rejects leaked node adapters", () => {
    assert.equal(
      findPlatformBoundaryViolation({
        packageName: "@mamep2026/web",
        relativePath: "src/host-factories/android.ts",
        specifier: "@mamep2026/platform-android/capacitor",
      }),
      null,
    );
    assert.equal(
      findPlatformBoundaryViolation({
        packageName: "@mamep2026/platform-node",
        relativePath: "src/real-serial-port.ts",
        specifier: "serialport",
      }),
      null,
    );
    assert.equal(
      findPlatformBoundaryViolation({
        packageName: "@mamep2026/platform-node",
        relativePath: "src/node-platform-host.ts",
        specifier: "serialport",
      })?.code,
      "PLATFORM_BOUNDARY_VIOLATION",
    );
    assert.equal(
      findPlatformBoundaryViolation({
        packageName: "@mamep2026/vscode-extension",
        relativePath: "src/webview/html.ts",
        specifier: "@mamep2026/platform-node",
      })?.code,
      "PLATFORM_BOUNDARY_VIOLATION",
    );
  });
});
