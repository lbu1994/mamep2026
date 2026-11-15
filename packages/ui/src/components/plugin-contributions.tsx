/**
 * panels 贡献点消费方（docs/architecture/ports/plugin-api/插件契约.md §3）。
 * 在底部面板渲染已注册插件面板区块。贡献 payload 为声明式描述（id + titleKey + 可选自带翻译
 * title）；交互式面板组件由插件 runtime 提供，当前渲染标题 + 占位内容。
 */
import { Divider, Empty } from "antd";
import { useTranslation } from "react-i18next";
import type { AppHost } from "../host";
import { usePluginContributions } from "../plugin/use-contributions";
import {
  pluginLocalizedTitle,
  type PluginLocalizedTitle,
} from "../plugin/plugin-title";

export interface PanelContribution {
  id: string;
  titleKey: string;
  /** 插件自带翻译（方案 A）：缺失当前语言时回退英文，再回退 titleKey。 */
  title?: PluginLocalizedTitle;
}

/** panels 贡献点消费方：host 为空或无可渲染面板时返回 null。 */
export function PluginPanels({
  host,
}: {
  host: AppHost | null;
}): React.ReactNode {
  const { t, i18n } = useTranslation();
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
              {pluginLocalizedTitle(
                panel.title,
                panel.titleKey,
                i18n.language,
                t,
              )}
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
