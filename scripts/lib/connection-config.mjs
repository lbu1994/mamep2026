/**
 * scripts 侧共享：连接对象配置文件（config/connections.json，ADR-023）读取 helper。
 * 供真实设备路径的探针/验证脚本读取主站连接参数，消除 COM4/COM5/9600 等硬编码。
 * 脚本是 Node 工具，直接用 fs 同步读取 + JSON.parse（不引入应用层 Zod 校验依赖；
 * 校验由应用侧 packages/connection-config 承担，脚本侧保持轻量）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录。 */
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** 配置文件路径（仓库根 config/connections.json）。 */
export const CONNECTION_CONFIG_PATH = path.join(
  ROOT,
  "config",
  "connections.json",
);

/** 读取并解析配置文件（schemaVersion 校验）。 */
export function loadConnectionConfig() {
  const raw = readFileSync(CONNECTION_CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `不支持的连接配置文件版本: ${String(parsed.schemaVersion)}（${CONNECTION_CONFIG_PATH}）`,
    );
  }
  return parsed;
}

/** 按 id 查找连接对象；不存在抛错（脚本 fail-fast）。 */
export function findConnection(id) {
  const config = loadConnectionConfig();
  const connection = config.connections.find((c) => c.id === id);
  if (connection === undefined) {
    throw new Error(`连接对象 "${id}" 未在 config/connections.json 中定义`);
  }
  return connection;
}
