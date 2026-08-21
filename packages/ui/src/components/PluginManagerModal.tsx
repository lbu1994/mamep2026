import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Empty,
  Flex,
  Listy,
  Modal,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useAppStore } from "../app-store";

/** 权限 → i18n 标签键映射；未登记的权限回退显示原始字符串。 */
const PERMISSION_LABEL_KEYS: Readonly<Record<string, string>> = {
  "ui.panel": "plugins.permission.uiPanel",
};

function permissionLabel(
  t: (key: string) => string,
  permission: string,
): string {
  const labelKey = PERMISSION_LABEL_KEYS[permission];
  return labelKey !== undefined ? t(labelKey) : permission;
}

export function PluginManagerModal(): React.ReactNode {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.pluginModalOpen);
  const setOpen = useAppStore((s) => s.setPluginModalOpen);
  const host = useAppStore((s) => s.host);
  const registry = host?.pluginRegistry ?? null;
  const [, forceRender] = useState(0);

  const plugins = registry?.list() ?? [];
  const loadErrors = registry?.getLoadErrors() ?? [];

  return (
    <Modal
      title={t("plugins.title")}
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
    >
      {plugins.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("plugins.empty")}
          style={{ padding: "16px 0" }}
        />
      ) : (
        <Listy
          rowKey={(plugin) => plugin.id}
          items={plugins}
          itemRender={(plugin) => (
            <Flex justify="space-between" align="center" gap={8}>
              <div style={{ minWidth: 0 }}>
                <div>
                  <Typography.Text strong>{plugin.name}</Typography.Text>{" "}
                  <Tag>{plugin.version}</Tag>
                </div>
                <Typography.Text type="secondary">
                  {plugin.description}
                </Typography.Text>
                <Space size={[8, 4]} wrap style={{ marginTop: 4 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t("plugins.author")}: {plugin.author ?? "—"}
                  </Typography.Text>
                  <Tooltip title={t("plugins.platformWebTooltip")}>
                    <Tag color={plugin.platform.web ? "blue" : "default"}>
                      {t("plugins.platformWeb")}
                    </Tag>
                  </Tooltip>
                  <Tooltip title={t("plugins.platformNodeTooltip")}>
                    <Tag color={plugin.platform.node ? "green" : "default"}>
                      {t("plugins.platformNode")}
                    </Tag>
                  </Tooltip>
                  {plugin.permissions.length > 0 ? (
                    <>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        {t("plugins.permissions")}:
                      </Typography.Text>
                      {plugin.permissions.map((permission) => (
                        <Tag key={permission} color="geekblue">
                          {permissionLabel(t, permission)}
                        </Tag>
                      ))}
                    </>
                  ) : null}
                </Space>
              </div>
              <Switch
                size="small"
                checked={registry?.isEnabled(plugin.id) ?? false}
                onChange={(checked) => {
                  registry?.setEnabled(plugin.id, checked);
                  forceRender((v) => v + 1);
                }}
              />
            </Flex>
          )}
        />
      )}
      {loadErrors.length > 0 ? (
        <div>
          <Typography.Text strong>{t("plugins.loadErrors")}</Typography.Text>
          {loadErrors.map((error, index) => (
            <Typography.Paragraph key={index} type="danger">
              [{error.errorCode}] {error.message}
            </Typography.Paragraph>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
