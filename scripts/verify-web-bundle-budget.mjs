import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_JS_CHUNK_BYTES = 400 * 1024;
export const MAX_INITIAL_GZIP_BYTES = 450 * 1024;

function resolveAsset(outputDir, reference) {
  const cleanReference = reference.split(/[?#]/, 1)[0];
  const relative = cleanReference.startsWith("/")
    ? cleanReference.slice(1)
    : cleanReference.replace(/^\.\//, "");
  const resolved = path.resolve(outputDir, relative);
  const root = path.resolve(outputDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`asset escapes output directory: ${reference}`);
  }
  return resolved;
}

function collectJavaScriptFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(candidate);
    return entry.isFile() && entry.name.endsWith(".js") ? [candidate] : [];
  });
}

export function measureBundleBudget(
  outputDir,
  {
    maxJsChunkBytes = MAX_JS_CHUNK_BYTES,
    maxInitialGzipBytes = MAX_INITIAL_GZIP_BYTES,
  } = {},
) {
  const indexPath = path.join(outputDir, "index.html");
  const html = readFileSync(indexPath);
  const htmlText = html.toString("utf8");
  const initialReferences = [
    ...htmlText.matchAll(
      /<(?:script|link)\b[^>]*(?:src|href)="([^"]+\.(?:js|css))"/g,
    ),
  ].map((match) => match[1]);
  if (initialReferences.length === 0) {
    throw new Error(`no initial JS/CSS assets found in ${indexPath}`);
  }

  const initialPaths = [
    indexPath,
    ...new Set(
      initialReferences.map((reference) => resolveAsset(outputDir, reference)),
    ),
  ];
  const initialBytes = initialPaths.reduce(
    (total, filePath) => total + statSync(filePath).size,
    0,
  );
  const initialGzipBytes = initialPaths.reduce(
    (total, filePath) => total + gzipSync(readFileSync(filePath)).length,
    0,
  );
  const jsFiles = collectJavaScriptFiles(path.join(outputDir, "assets"));
  const largestChunk = jsFiles.reduce(
    (largest, filePath) => {
      const bytes = statSync(filePath).size;
      return bytes > largest.bytes ? { filePath, bytes } : largest;
    },
    { filePath: "", bytes: 0 },
  );

  const failures = [];
  if (largestChunk.bytes > maxJsChunkBytes) {
    failures.push(
      `largest JS chunk ${path.basename(largestChunk.filePath)} is ${largestChunk.bytes} B (limit ${maxJsChunkBytes} B)`,
    );
  }
  if (initialGzipBytes > maxInitialGzipBytes) {
    failures.push(
      `initial gzip transfer is ${initialGzipBytes} B (limit ${maxInitialGzipBytes} B)`,
    );
  }

  return {
    initialRequests: initialPaths.length,
    initialBytes,
    initialGzipBytes,
    largestChunk,
    maxJsChunkBytes,
    maxInitialGzipBytes,
    failures,
  };
}

function main() {
  const outputDir = path.resolve(
    process.argv[2] ?? path.join(import.meta.dirname, "../apps/web/dist"),
  );
  const result = measureBundleBudget(outputDir);
  console.log(
    `[bundle-budget] ${path.relative(process.cwd(), outputDir) || "."}: ` +
      `${result.initialRequests} initial requests, ` +
      `${result.initialBytes} B raw, ${result.initialGzipBytes} B gzip, ` +
      `largest ${path.basename(result.largestChunk.filePath)} ${result.largestChunk.bytes} B`,
  );
  if (result.failures.length > 0) {
    throw new Error(result.failures.join("\n"));
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
