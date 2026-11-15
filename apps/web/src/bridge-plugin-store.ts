/**
 * Renderer 插件存储薄桥。
 * 实现 PluginStorePort：经 preload/vscode-bridge 白名单桥（window.mamepHost）调用
 * 主进程/扩展宿主持久化（plugin-store-load / plugin-store-save）。Electron 主进程
 * userData plugins.json、VSCode Extension Host globalState；Renderer 不直接触碰
 * 文件系统。载荷与 plugin-api 的 PluginStoreData 结构一致（结构收窄，非蒙混），
 * 本层直接透传；主进程/扩展宿主负责 Zod 校验与原子落盘。
 */
import type { Result } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import type { PluginStoreData, PluginStorePort } from "@mamep2026/plugin-api";
import type { MamepHostApi } from "@mamep2026/platform-api";

export class BridgePluginStore implements PluginStorePort {
  private readonly bridge: Pick<
    MamepHostApi,
    "pluginStoreLoad" | "pluginStoreSave"
  >;

  constructor(
    bridge: Pick<MamepHostApi, "pluginStoreLoad" | "pluginStoreSave">,
  ) {
    this.bridge = bridge;
  }

  async load(): Promise<Result<PluginStoreData>> {
    const result = await this.bridge.pluginStoreLoad();
    if (!result.ok) return result;
    // PluginStoreDataPayload 与 PluginStoreData 结构一致（schemaVersion:1 + plugins），
    // 直接透传；主进程返回空数组 = 首次启动（非错误）。
    return ok(result.value);
  }

  async save(data: PluginStoreData): Promise<Result<void>> {
    const result = await this.bridge.pluginStoreSave(data);
    if (!result.ok) return result;
    return ok(undefined);
  }
}
