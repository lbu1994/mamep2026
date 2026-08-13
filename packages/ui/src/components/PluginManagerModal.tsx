import { useState } from "react";
import { useTranslation } from "react-i18next";
import { List, Modal, Switch, Tag, Typography } from "antd";
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
        <List
          dataSource={plugins}
          renderItem={(plugin) => (
            <List.Item
              actions={[
                <Switch
                  key="enabled"
                  size="small"
                  checked={registry?.isEnabled(plugin.id) ?? false}
                  onChange={(checked) => {
                    registry?.setEnabled(plugin.id, checked);
                    forceRender((v) => v + 1);
                  }}
                />,
              ]}
            >
              <List.Item.Meta
                title={
                  <span>
                    {plugin.name} <Tag>{plugin.version}</Tag>
                  </span>
                }
                description={plugin.description}
              />
            </List.Item>
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
