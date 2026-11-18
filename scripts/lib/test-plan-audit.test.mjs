import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");

async function read(relativePath) {
  return await readFile(path.join(ROOT, relativePath), "utf8");
}

test("unit test plan excludes every separately orchestrated suite", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const command = packageJson.scripts.test;

  for (const packageName of [
    "acceptance",
    "e2e-web",
    "e2e-electron",
    "e2e-vscode",
    "e2e-android",
  ]) {
    assert.match(
      command,
      new RegExp(`--filter=!@mamep2026/${packageName}(?:\\s|\")`),
      `${packageName} must not run inside pnpm test`,
    );
  }
});

test("test-all executes each orchestrated suite step exactly once", async () => {
  const source = await read("scripts/test-all.mjs");
  const block = source.match(/const STEPS = \[([\s\S]*?)\];/);
  assert.ok(block, "STEPS block should exist");
  const steps = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.equal(
    new Set(steps).size,
    steps.length,
    "test-all steps must be unique",
  );
  assert.equal(
    steps.filter((step) => step === "test:acceptance").length,
    1,
    "acceptance must run exactly once",
  );
});

test("normal and virtual serial tests collect disjoint files", async () => {
  const platformPackage = JSON.parse(
    await read("packages/platform-node/package.json"),
  );
  const serialRunner = await read("scripts/serial-virtual-test.mjs");
  const normalConfig = await read("packages/platform-node/vitest.config.ts");
  const virtualConfig = await read(
    "packages/platform-node/vitest.virtual-serial.config.ts",
  );

  assert.equal(
    platformPackage.scripts["test:virtual-serial"],
    "vitest run --config vitest.virtual-serial.config.ts",
  );
  assert.match(
    serialRunner,
    /"@mamep2026\/platform-node",\s*"test:virtual-serial"/,
  );

  const virtualFiles = [
    "src/virtual-serial-loopback.test.ts",
    "src/virtual-serial.integration.test.ts",
  ];
  for (const file of virtualFiles) {
    assert.match(normalConfig, new RegExp(`exclude:[\\s\\S]*${file}`));
    assert.match(virtualConfig, new RegExp(`include:[\\s\\S]*${file}`));
  }
});

test("mock and real E2E runners use disjoint test roots", async () => {
  const webMock = await read("tests/e2e-web/playwright.config.ts");
  const webReal = await read("tests/e2e-web/playwright.real.config.ts");
  const electronMock = await read("tests/e2e-electron/playwright.config.ts");
  const electronReal = await read(
    "tests/e2e-electron/playwright.real.config.ts",
  );
  const vscodeMock = await read("tests/e2e-vscode/scripts/run-e2e.mjs");
  const vscodeReal = await read("tests/e2e-vscode/playwright.real.config.ts");

  assert.match(webMock, /testDir:\s*"\.\/tests"/);
  assert.match(webReal, /testDir:\s*"\.\/tests-real"/);
  assert.match(electronMock, /testDir:\s*"\.\/tests"/);
  assert.match(electronReal, /testDir:\s*"\.\/tests-real"/);
  assert.match(vscodeMock, /dist\/run\.test\.js/);
  assert.match(vscodeReal, /testDir:\s*path\.join\(__dirname,\s*"real"\)/);
});

test("each E2E platform suite has no duplicate test titles", async () => {
  const suites = [
    "tests/e2e-web/tests",
    "tests/e2e-web/tests-real",
    "tests/e2e-electron/tests",
    "tests/e2e-electron/tests-real",
    "tests/e2e-vscode/real",
    "tests/e2e-android/tests",
  ];

  for (const suite of suites) {
    const entries = await readdir(path.join(ROOT, suite), {
      recursive: true,
      withFileTypes: true,
    });
    const titles = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".spec.ts")) continue;
      const source = await readFile(
        path.join(entry.parentPath, entry.name),
        "utf8",
      );
      titles.push(
        ...[...source.matchAll(/^\s*test(?:\.skip)?\(\s*"([^"]+)"/gm)].map(
          (match) => match[1],
        ),
      );
    }

    const duplicates = titles.filter(
      (title, index) => titles.indexOf(title) !== index,
    );
    assert.deepEqual(
      [...new Set(duplicates)],
      [],
      `${suite} contains duplicate E2E test titles`,
    );
  }
});
