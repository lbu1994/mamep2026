/**
 * panels 贡献点消费方（docs/插件功能设计.md §3.2，ADR-039）。
 * 在底部面板渲染已注册插件面板区块。Phase A 无插件代码执行，贡献 payload 为声明式描述
 * （id + titleKey），渲染标题占位；交互式面板组件随 Phase F 插件 runtime 提供。
 */
import { Divider, Empty } from "antd";
import { useTranslation } from "react-i18next";
import type { AppHost } from "../host";
import { usePluginContributions } from "../plugin/use-contributions";

export interface PanelContribution {
  id: string;
  titleKey: string;
}

/** panels 贡献点消费方（ADR-039）：host 为空或无可渲染面板时返回 null。 */
export function PluginPanels({
  host,
}: {
  host: AppHost | null;
}): React.ReactNode {
  const { t } = useTranslation();
  const panels = usePluginContributions<PanelContribution[]>(host, "panels");
  if (panels.length === 0) return null;
  return (
    <div className="plugin-panels" data-testid="plugin-panels">
      {panels.flatMap((contribution) =>
        contribution.payload.map((panel) => (
          <section
            key={`${contribution.pluginId}-${panel.id}`}
            className="plugin-panel"
          >
            <Divider titlePlacement="left" plain>
              {t(panel.titleKey)}
            </Divider>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("plugins.panelPlaceholder")}
            />
          </section>
        )),
      )}
    </div>
  );
}
