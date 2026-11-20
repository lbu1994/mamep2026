import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { measureBundleBudget } from "../verify-web-bundle-budget.mjs";

function makeFixture({ initialPayload = "a", largeChunk = "b" } = {}) {
  const outputDir = mkdtempSync(path.join(tmpdir(), "mamep-bundle-budget-"));
  const assets = path.join(outputDir, "assets");
  mkdirSync(assets);
  writeFileSync(
    path.join(outputDir, "index.html"),
    [
      '<script type="module" src="/assets/index.js"></script>',
      '<link rel="modulepreload" href="/assets/shared.js">',
      '<link rel="stylesheet" href="/assets/index.css">',
    ].join("\n"),
  );
  writeFileSync(path.join(assets, "index.js"), initialPayload);
  writeFileSync(path.join(assets, "shared.js"), initialPayload);
  writeFileSync(path.join(assets, "index.css"), initialPayload);
  writeFileSync(path.join(assets, "large.js"), largeChunk);
  return outputDir;
}

describe("web bundle budget", () => {
  it("measures entry, modulepreload and stylesheet bytes", () => {
    const outputDir = makeFixture();
    try {
      const result = measureBundleBudget(outputDir, {
        maxJsChunkBytes: 1,
        maxInitialGzipBytes: 1_000,
      });
      assert.equal(result.initialRequests, 4);
      assert.ok(result.initialBytes > 0);
      assert.deepEqual(result.failures, []);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("reports both maximum chunk and initial gzip overruns", () => {
    const outputDir = makeFixture({ largeChunk: "x".repeat(64) });
    try {
      const result = measureBundleBudget(outputDir, {
        maxJsChunkBytes: 32,
        maxInitialGzipBytes: 1,
      });
      assert.equal(result.failures.length, 2);
      assert.match(result.failures[0], /largest JS chunk/);
      assert.match(result.failures[1], /initial gzip transfer/);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
