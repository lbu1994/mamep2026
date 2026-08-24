/**
 * VSCode Extension Host：连接对象配置文件加载（ADR-023）。
 * 从候选路径读取 config/connections.json 并解析；未找到返回 ok({config:null})，
 * 读取/解析失败返回结构化 MamepError。核心为纯函数（注入候选路径），便于单测。
 *
 * 路径策略（2026-08-24 确认）：
 *   1. 配置项 mamep2026.connectionConfigPath（显式指定，存在才用）；
 *   2. workspace 根 config/connections.json（workspaceFolders[0]）；
 *   3. 用户主目录 config/connections.json（os.homedir()）。
 * 生效时机：重连/重启时重新读取（无热更新）。
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  connectionConfigLoadError,
  parseConnectionConfig,
} from "@mamep2026/connection-config";
import { fail, ok, type Result } from "@mamep2026/domain";
import type { ConnectionConfigLoadResponse } from "@mamep2026/platform-api";

export interface VscodeConnectionConfigPathOptions {
  /** 配置项 mamep2026.connectionConfigPath（未设置传 undefined）。 */
  settingPath: string | undefined;
  /** workspace 根目录（无打开文件夹传 null）。 */
  workspaceRoot: string | null;
  /** 用户主目录（os.homedir()）。 */
  homeDir: string;
}

/** 构造候选路径（去重、忽略空值）。顺序即查找优先级。 */
export function resolveVscodeCandidatePaths(
  options: VscodeConnectionConfigPathOptions,
): string[] {
  const candidates: string[] = [];
  if (options.settingPath !== undefined && options.settingPath.length > 0) {
    candidates.push(options.settingPath);
  }
  if (options.workspaceRoot !== null && options.workspaceRoot.length > 0) {
    candidates.push(
      path.join(options.workspaceRoot, "config", "connections.json"),
    );
  }
  candidates.push(path.join(options.homeDir, "config", "connections.json"));
  return [...new Set(candidates)];
}

/** 按候选路径依次查找并加载；第一个存在的文件即采用（与 Electron 侧语义一致）。 */
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
