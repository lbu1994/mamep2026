import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Switch, Tag, Typography } from "antd";
import { useAppStore } from "../app-store";

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
        <Typography.Paragraph type="secondary">
          {t("plugins.empty")}
        </Typography.Paragraph>
      ) : (
        <div>
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "8px 0",
                borderBottom: "1px solid var(--ant-color-split)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div>
                  <Typography.Text strong>{plugin.name}</Typography.Text>{" "}
                  <Tag>{plugin.version}</Tag>
                </div>
                <Typography.Text type="secondary">
                  {plugin.description}
                </Typography.Text>
              </div>
              <Switch
                size="small"
                checked={registry?.isEnabled(plugin.id) ?? false}
                onChange={(checked) => {
                  registry?.setEnabled(plugin.id, checked);
                  forceRender((v) => v + 1);
                }}
              />
            </div>
          ))}
        </div>
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
