import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const TEST_SOURCE_PATTERN =
  /\.(?:test|spec|run)\.[cm]?[jt]sx?$|(?:^|\/)(?:test|tests|testing)(?:\/|$)/;
const CONFIG_SOURCE_PATTERN =
  /(?:^|\/)[^/]*\.config\.[cm]?[jt]s$|(?:^|\/)scripts?(?:\/|$)/;
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((moduleName) => [
    moduleName,
    moduleName.startsWith("node:")
      ? moduleName.slice("node:".length)
      : `node:${moduleName}`,
  ]),
);

const HOST_MODULE_NAMES = new Set(["electron", "vscode", "serialport"]);
const PLATFORM_HOST_PACKAGES = new Set([
  "@mamep2026/platform-android",
  "@mamep2026/platform-node",
  "@mamep2026/platform-web",
]);

/**
 * 平台无关层只依赖契约与领域包。Host 适配器只能由各运行端 composition root 装配。
 * `platform-api` 是纯契约包，保留在允许集合内。
 */
const PLATFORM_AGNOSTIC_PACKAGES = new Set([
  "@mamep2026/application",
  "@mamep2026/communication",
  "@mamep2026/data-conversion",
  "@mamep2026/domain",
  "@mamep2026/logging",
  "@mamep2026/platform-api",
  "@mamep2026/plugin-api",
  "@mamep2026/protocol-modbus",
  "@mamep2026/register-table",
  "@mamep2026/ui",
  "@mamep2026/ui-theme",
  "@mamep2026/workspace",
]);

/**
 * 这些依赖不来自静态 import，但会被最终产物或原生容器直接消费。
 * 其余未使用的 production dependency 都视为清单漂移。
 */
const RUNTIME_DEPENDENCY_ALLOWLIST = new Map([
  [
    "@mamep2026/android",
    new Set(["@capacitor/android", "@capacitor/app", "@capacitor/core"]),
  ],
  // VSCode 的 esbuild 将 serialport 保持 external，发布时必须从 node_modules 安装。
  ["@mamep2026/vscode-extension", new Set(["serialport"])],
]);

const TEST_HOST_MODULES = new Map([
  ["@mamep2026/e2e-vscode", new Set(["vscode"])],
]);

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isInside(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readWorkspacePatterns(root) {
  const workspaceFile = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspaceFile)) {
    throw new Error(`missing workspace file: ${workspaceFile}`);
  }
  const patterns = [];
  let inPackages = false;
  for (const line of fs.readFileSync(workspaceFile, "utf8").split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^\S/.test(line)) break;
    const match = /^\s*-\s*["']?([^"']+)["']?\s*$/.exec(line);
    if (match?.[1] !== undefined) patterns.push(match[1]);
  }
  if (patterns.length === 0) {
    throw new Error("pnpm-workspace.yaml has no package patterns");
  }
  return patterns;
}

function expandWorkspacePattern(root, pattern) {
  const wildcardCount = [...pattern].filter((char) => char === "*").length;
  if (wildcardCount === 0) {
    return [path.resolve(root, pattern)];
  }
  if (wildcardCount !== 1) {
    throw new Error(`unsupported workspace pattern: ${pattern}`);
  }
  const [prefix, suffix] = pattern.split("*");
  const base = path.resolve(root, prefix);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.resolve(base, `${entry.name}${suffix ?? ""}`))
    .filter((directory) => fs.existsSync(path.join(directory, "package.json")));
}

/**
 * 返回根应用包与 pnpm workspace 包。根包保留在审计内，避免根清单继续掩盖
 * 子包漏声明或保留已迁移到子包的重复 production dependency。
 */
export function discoverWorkspacePackages(root) {
  const directories = new Set([root]);
  for (const pattern of readWorkspacePatterns(root)) {
    for (const directory of expandWorkspacePattern(root, pattern)) {
      directories.add(directory);
    }
  }
  return [...directories]
    .sort((left, right) => left.localeCompare(right))
    .map((directory) => {
      const manifestPath = path.join(directory, "package.json");
      return {
        directory,
        manifestPath,
        manifest: readJson(manifestPath),
      };
    });
}

function collectSourceFiles(directory, root) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(candidate);
      } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
        files.push(candidate);
      }
    }
  };
  for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
    if (child.isFile() && SOURCE_FILE_PATTERN.test(child.name)) {
      files.push(path.join(directory, child.name));
    }
  }
  const sourceRoots = ["src", "scripts", "helpers"];
  // 根目录的 tests/* 是独立 workspace 包，根包审计不能递归吞并它们。
  if (directory !== root) sourceRoots.push("tests");
  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.join(directory, sourceRoot);
    if (fs.existsSync(absoluteRoot)) visit(absoluteRoot);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function scriptKindFor(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (
    filePath.endsWith(".js") ||
    filePath.endsWith(".mjs") ||
    filePath.endsWith(".cjs")
  ) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isFullyTypeOnlyImport(node) {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name !== undefined) return false;
  return (
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function isFullyTypeOnlyExport(node) {
  if (node.isTypeOnly) return true;
  return (
    node.exportClause !== undefined &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly)
  );
}

function stringLiteralText(node) {
  return node !== undefined && ts.isStringLiteral(node) ? node.text : null;
}

/**
 * 使用 TypeScript AST 提取静态、动态、类型与 CommonJS 引用，避免正则被换行或注释误导。
 */
export function extractModuleReferences(filePath, sourceText = null) {
  const text = sourceText ?? fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const references = [];
  const add = (specifier, typeOnly) => {
    if (specifier !== null) references.push({ specifier, typeOnly });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      add(stringLiteralText(node.moduleSpecifier), isFullyTypeOnlyImport(node));
    } else if (ts.isExportDeclaration(node)) {
      add(stringLiteralText(node.moduleSpecifier), isFullyTypeOnlyExport(node));
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add(stringLiteralText(node.arguments[0]), false);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      add(stringLiteralText(node.arguments[0]), false);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      add(stringLiteralText(node.argument.literal), true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

export function parsePackageSpecifier(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return null;
  }
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    if (parts.length < 2) return null;
    return {
      packageName: parts.slice(0, 2).join("/"),
      subpath: parts.slice(2).join("/"),
    };
  }
  return {
    packageName: parts[0],
    subpath: parts.slice(1).join("/"),
  };
}

export function isRuntimeSource(filePath) {
  const normalized = toPosixPath(filePath);
  return (
    !TEST_SOURCE_PATTERN.test(normalized) &&
    !CONFIG_SOURCE_PATTERN.test(normalized)
  );
}

function isCapacitorModule(packageName) {
  return packageName?.startsWith("@capacitor/") ?? false;
}

/**
 * 平台 API 泄漏策略。返回 null 表示边界允许。
 */
export function findPlatformBoundaryViolation({
  packageName,
  relativePath,
  specifier,
}) {
  const parsed = parsePackageSpecifier(specifier);
  const importedPackage = parsed?.packageName ?? null;
  const normalizedPath = toPosixPath(relativePath);
  const importsNodeBuiltin =
    specifier.startsWith("node:") ||
    (importedPackage !== null && NODE_BUILTINS.has(importedPackage));
  const importsHostModule =
    importedPackage !== null &&
    (HOST_MODULE_NAMES.has(importedPackage) ||
      isCapacitorModule(importedPackage) ||
      PLATFORM_HOST_PACKAGES.has(importedPackage));

  if (PLATFORM_AGNOSTIC_PACKAGES.has(packageName)) {
    if (importsNodeBuiltin) {
      return {
        code: "PLATFORM_BOUNDARY_VIOLATION",
        message: "平台无关层不得直接引用 Node.js 内置模块",
      };
    }
    if (importsHostModule) {
      return {
        code: "PLATFORM_BOUNDARY_VIOLATION",
        message: "平台无关层不得直接引用平台 Host 或宿主 API",
      };
    }
  }

  if (packageName === "@mamep2026/web") {
    if (importsNodeBuiltin) {
      return {
        code: "PLATFORM_BOUNDARY_VIOLATION",
        message: "共享 Web 渲染器不得直接引用 Node.js 内置模块",
      };
    }
    if (
      importedPackage === "electron" ||
      importedPackage === "vscode" ||
      importedPackage === "serialport" ||
      importedPackage === "@mamep2026/platform-node" ||
      isCapacitorModule(importedPackage)
    ) {
      return {
        code: "PLATFORM_BOUNDARY_VIOLATION",
        message:
          "Web 渲染器只能经平台工厂或白名单桥访问宿主能力，不得直连宿主 API",
      };
    }
  }

  if (packageName === "@mamep2026/platform-web") {
    if (importsNodeBuiltin || importsHostModule) {
      return {
        code: "PLATFORM_BOUNDARY_VIOLATION",
        message: "platform-web 只允许浏览器 Web 能力",
      };
    }
  }

  if (packageName === "@mamep2026/platform-android") {
    if (
      importsNodeBuiltin ||
      importedPackage === "electron" ||
      importedPackage === "vscode" ||
      importedPackage === "serialport" ||
      importedPackage === "@mamep2026/platform-node"
    ) {
      return {
        code: "PLATFORM_BOUNDARY_VIOLATION",
        message: "platform-android 不得引用 Node/Electron/VSCode 宿主能力",
      };
    }
  }

  if (packageName === "@mamep2026/platform-node") {
    if (
      importedPackage === "electron" ||
      importedPackage === "vscode" ||
      importedPackage === "@mamep2026/platform-web" ||
      importedPackage === "@mamep2026/platform-android" ||
      isCapacitorModule(importedPackage)
    ) {
      return {
        code: "PLATFORM_BOUNDARY_VIOLATION",
        message: "platform-node 不得引用其他运行端适配器",
      };
    }
    if (
      importedPackage === "serialport" &&
      normalizedPath !== "src/real-serial-port.ts"
    ) {
      return {
        code: "PLATFORM_BOUNDARY_VIOLATION",
        message: "serialport 必须封装在 src/real-serial-port.ts",
      };
    }
  }

  if (
    packageName === "@mamep2026/vscode-extension" &&
    normalizedPath.startsWith("src/webview/") &&
    (importsNodeBuiltin ||
      importedPackage === "electron" ||
      importedPackage === "serialport" ||
      importedPackage === "@mamep2026/platform-node")
  ) {
    return {
      code: "PLATFORM_BOUNDARY_VIOLATION",
      message: "VSCode Webview 只能经 HostMessage 白名单桥访问扩展宿主",
    };
  }

  return null;
}

export function findRuntimeDependencyCycles(graph) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  const visit = (packageName, stack) => {
    if (visiting.has(packageName)) {
      const start = stack.indexOf(packageName);
      cycles.push([...stack.slice(start), packageName]);
      return;
    }
    if (visited.has(packageName)) return;
    visiting.add(packageName);
    stack.push(packageName);
    for (const dependency of graph.get(packageName) ?? []) {
      visit(dependency, stack);
    }
    stack.pop();
    visiting.delete(packageName);
    visited.add(packageName);
  };

  for (const packageName of [...graph.keys()].sort()) {
    visit(packageName, []);
  }
  return cycles;
}

function collectViolation(violations, violation) {
  violations.push(violation);
}

export function auditWorkspaceBoundaries(root) {
  const packages = discoverWorkspacePackages(root);
  const byName = new Map(packages.map((entry) => [entry.manifest.name, entry]));
  const violations = [];
  const runtimeGraph = new Map();
  let sourceFileCount = 0;
  let runtimeEdgeCount = 0;

  for (const entry of packages) {
    const { manifest, directory, manifestPath } = entry;
    const relativeManifest = toPosixPath(path.relative(root, manifestPath));
    const relativePackageDirectory = toPosixPath(
      path.relative(root, directory),
    );
    const isTestWorkspace =
      relativePackageDirectory === "tests" ||
      relativePackageDirectory.startsWith("tests/");
    if (byName.get(manifest.name) !== entry) {
      collectViolation(violations, {
        code: "DUPLICATE_WORKSPACE_PACKAGE",
        packageName: manifest.name,
        file: relativeManifest,
        message: "workspace package name must be unique",
      });
    }

    const productionDependencies = new Set(
      Object.keys(manifest.dependencies ?? {}),
    );
    const developmentDependencies = new Set(
      Object.keys(manifest.devDependencies ?? {}),
    );
    const peerDependencies = new Set(
      Object.keys(manifest.peerDependencies ?? {}),
    );
    const optionalDependencies = new Set(
      Object.keys(manifest.optionalDependencies ?? {}),
    );
    const allDeclared = new Set([
      ...productionDependencies,
      ...developmentDependencies,
      ...peerDependencies,
      ...optionalDependencies,
    ]);
    const usedByProductionSource = new Set();
    const moduleReferences = [];
    const sourceFiles = collectSourceFiles(directory, root);
    sourceFileCount += sourceFiles.length;

    for (const sourceFile of sourceFiles) {
      const relativeSource = toPosixPath(path.relative(directory, sourceFile));
      const relativeDisplay = toPosixPath(path.relative(root, sourceFile));
      for (const reference of extractModuleReferences(sourceFile)) {
        const { specifier, typeOnly } = reference;
        if (specifier.startsWith(".")) {
          const resolved = path.resolve(path.dirname(sourceFile), specifier);
          if (!isInside(directory, resolved)) {
            collectViolation(violations, {
              code: "CROSS_PACKAGE_RELATIVE_IMPORT",
              packageName: manifest.name,
              file: relativeDisplay,
              specifier,
              message:
                "cross-package relative imports bypass public package exports",
            });
          }
          continue;
        }

        const parsed = parsePackageSpecifier(specifier);
        if (parsed === null) continue;
        const { packageName: importedName, subpath } = parsed;
        if (importedName === manifest.name) continue;
        if (!isTestWorkspace && isRuntimeSource(relativeSource)) {
          usedByProductionSource.add(importedName);
        }
        moduleReferences.push({
          specifier,
          importedName,
          subpath,
          typeOnly,
          relativeDisplay,
          isRuntime: !isTestWorkspace && isRuntimeSource(relativeSource),
        });
      }
    }

    for (const reference of moduleReferences) {
      const { importedName, subpath, typeOnly, relativeDisplay, isRuntime } =
        reference;
      const isNodeBuiltin =
        reference.specifier.startsWith("node:") ||
        NODE_BUILTINS.has(importedName);
      const isHostProvided =
        (importedName === "vscode" &&
          manifest.name === "@mamep2026/vscode-extension") ||
        (importedName === "electron" &&
          manifest.name === "@mamep2026/electron") ||
        TEST_HOST_MODULES.get(manifest.name)?.has(importedName) === true;

      if (!isNodeBuiltin && !isHostProvided && !allDeclared.has(importedName)) {
        collectViolation(violations, {
          code: "MISSING_DEPENDENCY",
          packageName: manifest.name,
          file: relativeDisplay,
          specifier: reference.specifier,
          message: `missing dependency declaration for ${importedName}`,
        });
      } else if (
        !isNodeBuiltin &&
        !isHostProvided &&
        isRuntime &&
        !typeOnly &&
        !productionDependencies.has(importedName) &&
        !peerDependencies.has(importedName) &&
        !optionalDependencies.has(importedName) &&
        developmentDependencies.has(importedName)
      ) {
        collectViolation(violations, {
          code: "RUNTIME_DEV_DEPENDENCY",
          packageName: manifest.name,
          file: relativeDisplay,
          specifier: reference.specifier,
          message: `${importedName} is used by production code but only declared in devDependencies`,
        });
      }

      const importedWorkspacePackage = byName.get(importedName);
      if (importedWorkspacePackage !== undefined && !isNodeBuiltin) {
        const exportsField = importedWorkspacePackage.manifest.exports;
        const exportKey = subpath === "" ? "." : `./${subpath}`;
        if (
          exportsField !== undefined &&
          typeof exportsField === "object" &&
          !(exportKey in exportsField)
        ) {
          collectViolation(violations, {
            code: "NON_EXPORTED_WORKSPACE_SUBPATH",
            packageName: manifest.name,
            file: relativeDisplay,
            specifier: reference.specifier,
            message: `${importedName} does not export ${exportKey}`,
          });
        }
      }
    }

    const workspaceDependencies = [...productionDependencies]
      .filter((dependency) => dependency.startsWith("@mamep2026/"))
      .sort();
    runtimeGraph.set(manifest.name, workspaceDependencies);
    runtimeEdgeCount += workspaceDependencies.length;

    for (const dependency of allDeclared) {
      const declaration = manifest.dependencies?.[dependency];
      if (declaration === "workspace:*" && !byName.has(dependency)) {
        collectViolation(violations, {
          code: "INVALID_WORKSPACE_DEPENDENCY",
          packageName: manifest.name,
          file: relativeManifest,
          specifier: dependency,
          message: `${dependency} is declared as a workspace package but is not in the workspace`,
        });
      }
    }

    const allowlisted =
      RUNTIME_DEPENDENCY_ALLOWLIST.get(manifest.name) ?? new Set();
    for (const dependency of productionDependencies) {
      if (
        !isTestWorkspace &&
        !usedByProductionSource.has(dependency) &&
        !allowlisted.has(dependency)
      ) {
        collectViolation(violations, {
          code: "UNUSED_RUNTIME_DEPENDENCY",
          packageName: manifest.name,
          file: relativeManifest,
          specifier: dependency,
          message: `${dependency} is declared in dependencies but has no production-source import or explicit packaging use`,
        });
      }
    }

    for (const sourceFile of sourceFiles) {
      const relativeSource = toPosixPath(path.relative(directory, sourceFile));
      const relativeDisplay = toPosixPath(path.relative(root, sourceFile));
      if (isTestWorkspace || !isRuntimeSource(relativeSource)) continue;
      for (const reference of extractModuleReferences(sourceFile)) {
        const boundaryViolation = findPlatformBoundaryViolation({
          packageName: manifest.name,
          relativePath: relativeSource,
          specifier: reference.specifier,
        });
        if (boundaryViolation !== null) {
          collectViolation(violations, {
            ...boundaryViolation,
            packageName: manifest.name,
            file: relativeDisplay,
            specifier: reference.specifier,
          });
        }
      }
    }
  }

  for (const cycle of findRuntimeDependencyCycles(runtimeGraph)) {
    collectViolation(violations, {
      code: "RUNTIME_DEPENDENCY_CYCLE",
      packageName: cycle[0],
      file: "package.json",
      specifier: cycle.join(" -> "),
      message: `runtime workspace dependency cycle: ${cycle.join(" -> ")}`,
    });
  }

  return {
    violations,
    summary: {
      packageCount: packages.length,
      sourceFileCount,
      runtimeEdgeCount,
    },
  };
}

export function formatAuditResult(result) {
  if (result.violations.length === 0) {
    return `[boundary-audit] ${result.summary.packageCount} packages, ${result.summary.sourceFileCount} source files, ${result.summary.runtimeEdgeCount} runtime workspace edges: OK`;
  }
  const lines = [`[boundary-audit] ${result.violations.length} violation(s)`];
  for (const violation of result.violations) {
    const subject =
      violation.specifier === undefined ? "" : ` (${violation.specifier})`;
    lines.push(
      `${violation.code} ${violation.packageName} ${violation.file}${subject}: ${violation.message}`,
    );
  }
  return lines.join("\n");
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  const root = path.resolve(path.dirname(scriptPath), "../..");
  const result = auditWorkspaceBoundaries(root);
  console.log(formatAuditResult(result));
  process.exitCode = result.violations.length === 0 ? 0 : 1;
}
