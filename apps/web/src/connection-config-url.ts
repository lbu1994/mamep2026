/**
 * 浏览器端连接对象配置文件 URL 参数载入（ADR-023）。
 * 浏览器无文件系统（capabilities.connectionConfig === "import"），通过
 * `?connectionConfig=<base64>` URL 参数或 UI 导入 JSON 文件载入外部连接对象。
 * URL 参数为 base64 编码的配置文件 JSON（便于在 URL 中安全传输）。
 */
import { parseConnectionConfig } from "@mamep2026/connection-config";
import type { ConnectionConfigFile } from "@mamep2026/connection-config";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";

export const CONNECTION_CONFIG_URL_PARAM = "connectionConfig";

/** base64（URL 安全或标准）解码为 UTF-8 文本。 */
export function decodeUrlBase64(encoded: string): string {
  // 兼容 base64url（-/_）与标准 base64（+/）。
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export interface UrlConnectionConfigResult {
  config: ConnectionConfigFile;
  /** 固定来源标记（诊断/展示用）。 */
  sourcePath: string;
}

/**
 * 从 location.search 解析 `?connectionConfig=` 参数：
 * - 无该参数返回 null（正常启动路径）；
 * - 有参数但解码/校验失败返回 fail（不阻塞启动，UI 载入时展示错误）。
 */
export function parseConnectionConfigFromUrl(
  search: string,
): Result<UrlConnectionConfigResult> | null {
  const params = new URLSearchParams(search);
  const encoded = params.get(CONNECTION_CONFIG_URL_PARAM);
  if (encoded === null || encoded.length === 0) return null;
  let text: string;
  try {
    text = decodeUrlBase64(encoded);
  } catch (cause) {
    return fail(
      createMamepError({
        code: "CONNECTION_CONFIG_URL_INVALID",
        category: "validation",
        userMessageKey: "connection.configInvalidJson",
        technicalMessage:
          cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
    );
  }
  const parsed = parseConnectionConfig(text);
  if (!parsed.ok) return parsed;
  return ok({ config: parsed.value, sourcePath: "url" });
}
