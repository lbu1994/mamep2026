/**
 * Electron 主进程：连接对象配置文件加载（ADR-023）。
 * 从候选路径读取 config/connections.json 并解析；未找到返回 ok({config:null})，
 * 读取/解析失败返回结构化 MamepError。核心为纯函数（注入候选路径），便于单测。
 *
 * 路径策略（2026-08-24 确认）：
 *   1. 环境变量 MAMEP_CONNECTION_CONFIG 显式指定（存在才用）；
 *   2. dev（electron .）：仓库根 config/connections.json（process.cwd()）；
 *      打包（app.isPackaged）：exe 目录 config/connections.json；
 *   3. 用户数据目录 config/connections.json（app.getPath("userData")）。
 * 生效时机：重连/重启时重新读取（无热更新）。
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  connectionConfigLoadError,
  parseConnectionConfig,
} from "@mamep2026/connection-config";
import { fail, ok, type Result } from "@mamep2026/domain";
import type { ConnectionConfigLoadResponse } from "@mamep2026/platform-api";

export interface ConnectionConfigPathOptions {
  /** 环境变量 MAMEP_CONNECTION_CONFIG 指定路径（未设置传 undefined）。 */
  envPath: string | undefined;
  /** 仓库根（dev，process.cwd()）或 exe 目录（打包）。 */
  appRootDir: string;
  /** Electron 用户数据目录（app.getPath("userData")）。 */
  userDataDir: string;
}

/** 构造候选路径（去重、忽略空值）。顺序即查找优先级。 */
export function resolveCandidatePaths(
  options: ConnectionConfigPathOptions,
): string[] {
  const candidates: string[] = [];
  if (options.envPath !== undefined && options.envPath.length > 0) {
    candidates.push(options.envPath);
  }
  candidates.push(path.join(options.appRootDir, "config", "connections.json"));
  candidates.push(path.join(options.userDataDir, "config", "connections.json"));
  return [...new Set(candidates)];
}

/** 按候选路径依次查找并加载；第一个存在的文件即采用。 */
export async function loadConnectionConfig(
  candidates: readonly string[],
): Promise<Result<ConnectionConfigLoadResponse>> {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    let text: string;
    try {
      text = await readFile(candidate, "utf8");
    } catch (cause) {
      return fail(connectionConfigLoadError(candidate, cause));
    }
    const parsed = parseConnectionConfig(text);
    if (!parsed.ok) {
      return fail(parsed.error);
    }
    return ok({ config: parsed.value, sourcePath: candidate });
  }
  // 未找到任何配置文件：可选能力，非错误。
  return ok({ config: null, sourcePath: null });
}
