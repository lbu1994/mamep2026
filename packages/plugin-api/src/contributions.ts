/**
 * 贡献点注册表（docs/architecture/ports/plugin-api/插件契约.md §3）——可扩展性底座（需求⑥）。
 * 核心注册贡献点（id + Zod schema），插件向贡献点提交贡献；新能力 = 核心注册新贡献点并
 * 扩展 contributes 类型，不破坏存量插件。未登记贡献点 → PLUGIN_CONTRIBUTION_UNKNOWN，
 * 错误隔离，不影响其他贡献点加载。
 * 注意：schema 与注册机制定义于此（plugin-api 不依赖 UI）；真实消费方由 UI 层注册并
 * 经 getContributions 读取。
 */
import { z } from "zod";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";

/** 贡献点 ID：开放字符串（面向未来扩展，无封闭枚举）。 */
export type ContributionPointId = string;

export interface ContributionPoint<TSchema> {
  id: ContributionPointId;
  schema: z.ZodType<TSchema>;
}

/** 某插件对某贡献点的一条有效贡献（payload 已经对应点 schema 校验）。 */
export interface Contribution<TSchema> {
  pluginId: string;
  payload: TSchema;
}

/** 单点贡献校验失败信息（addContributions 逐点收集，不抛异常）。 */
export interface PluginContributionError {
  pluginId: string;
  pointId: ContributionPointId;
  errorCode: string;
  message: string;
}

export const PLUGIN_CONTRIBUTION_UNKNOWN = "PLUGIN_CONTRIBUTION_UNKNOWN";
export const PLUGIN_CONTRIBUTION_INVALID = "PLUGIN_CONTRIBUTION_INVALID";
export const PLUGIN_CONTRIBUTION_POINT_EXISTS =
  "PLUGIN_CONTRIBUTION_POINT_EXISTS";

interface ActiveContribution {
  pluginId: string;
  payload: unknown;
}

export class ContributionPointRegistry {
  private readonly points = new Map<
    ContributionPointId,
    ContributionPoint<unknown>
  >();
  private readonly contributions = new Map<
    ContributionPointId,
    ActiveContribution[]
  >();
  /** pluginId → 贡献是否生效（禁用 / 激活失败时置 false，getContributions 过滤）。 */
  private readonly active = new Map<string, boolean>();

  registerPoint<TSchema>(point: ContributionPoint<TSchema>): Result<void> {
    if (this.points.has(point.id)) {
      return fail(
        createMamepError({
          code: PLUGIN_CONTRIBUTION_POINT_EXISTS,
          category: "plugin",
          userMessageKey: "errors.pluginContributionPointExists",
          technicalMessage: `contribution point ${point.id} is already registered`,
        }),
      );
    }
    this.points.set(point.id, point as unknown as ContributionPoint<unknown>);
    return ok(undefined);
  }

  hasPoint(id: ContributionPointId): boolean {
    return this.points.has(id);
  }

  getRegisteredPointIds(): ContributionPointId[] {
    return [...this.points.keys()];
  }

  /**
   * 校验并登记插件贡献：未知点 → PLUGIN_CONTRIBUTION_UNKNOWN；payload 不合法 →
   * PLUGIN_CONTRIBUTION_INVALID。返回逐点校验错误数组，调用方决定是否阻断整个注册。
   */
  addContributions(
    pluginId: string,
    contributes: Record<string, unknown>,
  ): PluginContributionError[] {
    const errors: PluginContributionError[] = [];
    for (const [pointId, rawPayload] of Object.entries(contributes)) {
      const point = this.points.get(pointId);
      if (point === undefined) {
        errors.push({
          pluginId,
          pointId,
          errorCode: PLUGIN_CONTRIBUTION_UNKNOWN,
          message: `contribution point ${pointId} is not registered`,
        });
        continue;
      }
      const parsed = point.schema.safeParse(rawPayload);
      if (!parsed.success) {
        errors.push({
          pluginId,
          pointId,
          errorCode: PLUGIN_CONTRIBUTION_INVALID,
          message: parsed.error.message,
        });
        continue;
      }
      const list = this.contributions.get(pointId) ?? [];
      list.push({ pluginId, payload: parsed.data });
      this.contributions.set(pointId, list);
    }
    return errors;
  }

  removePluginContributions(pluginId: string): void {
    for (const [pointId, list] of this.contributions) {
      const next = list.filter((c) => c.pluginId !== pluginId);
      if (next.length === 0) {
        this.contributions.delete(pointId);
      } else {
        this.contributions.set(pointId, next);
      }
    }
    this.active.delete(pluginId);
  }

  /** 启用/激活成功置 true；禁用 / 激活失败置 false（getContributions 过滤 false 源）。 */
  setContributionsActive(pluginId: string, active: boolean): void {
    this.active.set(pluginId, active);
  }

  /** 聚合某贡献点的全部有效贡献（仅活跃插件；未显式设置 active 的按活跃处理）。 */
  getContributions<TSchema>(id: ContributionPointId): Contribution<TSchema>[] {
    const list = this.contributions.get(id) ?? [];
    return list
      .filter((c) => this.active.get(c.pluginId) !== false)
      .map((c) => ({ pluginId: c.pluginId, payload: c.payload as TSchema }));
  }
}
