import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App,
  Button,
  Descriptions,
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
import { DeleteOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import {
  PERMISSION_LABEL_KEYS,
  pluginManifestSchema,
  type PermissionId,
} from "@mamep2026/plugin-api";
import { useAppStore } from "../app-store";
import type { AppHost } from "../host";

/** 权限 → i18n 标签键映射（ADR-039）：共享自 plugin-api，未登记权限回退显示原始字符串。 */
function permissionLabel(
  t: (key: string) => string,
  permission: PermissionId,
): string {
  const labelKey = PERMISSION_LABEL_KEYS[permission];
  return labelKey !== undefined ? t(labelKey) : permission;
}

export function PluginManagerModal(): React.ReactNode {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const open = useAppStore((s) => s.pluginModalOpen);
  const setOpen = useAppStore((s) => s.setPluginModalOpen);
  const host = useAppStore((s) => s.host);
  const registry = host?.pluginRegistry ?? null;
  const [, forceRender] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const plugins = registry?.list() ?? [];
  const loadErrors = registry?.getLoadErrors() ?? [];

  /**
   * 单文件 JS 插件安装（ADR-044 Phase F-2/3）：entrySource 含 manifest + activate，
   * 在隔离线程（Web Worker）加载提取 manifest → 校验 → §6.10.4 安全确认（含运行位置）→
   * registry.register({source:"installed", remoteRuntime, entrySource})。
   */
  const handlePluginSourceText = async (text: string): Promise<void> => {
    if (registry === null || host === null) return;
    if (!host.capabilities.executablePlugins) {
      message.error(t("plugins.executableUnsupported"));
      return;
    }
    // 创建隔离运行时并加载 entry（Worker 内 import 提取 manifest）。
    let runtime: ReturnType<AppHost["createPluginRemoteRuntime"]>;
    let loadResult: Awaited<ReturnType<typeof runtime.load>>;
    try {
      runtime = host.createPluginRemoteRuntime(text);
      loadResult = await runtime.load();
    } catch {
      message.error(t("errors.pluginLoadFailed"));
      return;
    }
    if (!loadResult.ok) {
      message.error(t("errors.pluginLoadFailed"));
      return;
    }
    const manifest = loadResult.value;
    void modal.confirm({
      title: t("plugins.installConfirmTitle"),
      content: (
        <div>
          <Typography.Paragraph type="secondary">
            {t("plugins.installConfirmWarning")}
          </Typography.Paragraph>
          <Typography.Paragraph type="warning">
            {t("plugins.executableEntryNotice")}
          </Typography.Paragraph>
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t("plugins.name")}>
              <Typography.Text strong>{manifest.name}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.author")}>
              {manifest.author ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.version")}>
              {manifest.version}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.entry")}>
              <Space size={4}>
                <Tag color="orange">{t("plugins.entryIsolated")}</Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.permissions")}>
              {manifest.permissions.length > 0 ? (
                <Space size={[4, 4]} wrap>
                  {manifest.permissions.map((permission: PermissionId) => (
                    <Tag key={permission} color="geekblue">
                      {permissionLabel(t, permission)}
                    </Tag>
                  ))}
                </Space>
              ) : (
                "—"
              )}
            </Descriptions.Item>
          </Descriptions>
        </div>
      ),
      okText: t("plugins.installConfirmOk"),
      cancelText: t("connection.cancel"),
      okButtonProps: { danger: true },
      onOk: () => {
        const result = registry.register(manifest, {
          source: "installed",
          remoteRuntime: runtime,
          entrySource: text,
        });
        if (!result.ok) {
          message.error(t(result.error.userMessageKey));
          return;
        }
        message.success(t("plugins.installSuccess"));
        forceRender((v) => v + 1);
      },
      onCancel: () => {
        // 取消安装：关闭隔离线程。
        void runtime.dispose();
      },
    });
  };

  /** 已读取的插件文件文本：JSON = 清单注册（既有路径）；JS = 单文件可执行插件（隔离加载）。 */
  const handlePluginFileText = (text: string): void => {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{")) {
      handleManifestText(text);
      return;
    }
    void handlePluginSourceText(text);
  };

  /** 已读取的 manifest 文本：JSON.parse + pluginManifestSchema 校验 → 平台预检 →
   * §6.10.4/§15.3-3 安全确认（来源/版本/权限/平台/风险）→ 确认后 registry.register
   * （source: "installed"，持久化由 PluginPersistenceCoordinator 承担）。
   */
  const handleManifestText = (text: string): void => {
    if (registry === null) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      message.error(t("errors.pluginManifestInvalid"));
      return;
    }
    const parsed = pluginManifestSchema.safeParse(data);
    if (!parsed.success) {
      message.error(t("errors.pluginManifestInvalid"));
      return;
    }
    const manifest = parsed.data;
    // 平台能力预检（§6.10.2：不支持当前平台的插件不得被错误启用；与注册表守卫一致，
    // 仅做更友好的前置提示）。
    if (!manifest.platform.web) {
      message.error(t("errors.pluginPlatformUnsupported"));
      return;
    }
    void modal.confirm({
      title: t("plugins.installConfirmTitle"),
      content: (
        <div>
          <Typography.Paragraph type="secondary">
            {t("plugins.installConfirmWarning")}
          </Typography.Paragraph>
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t("plugins.name")}>
              <Typography.Text strong>{manifest.name}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.author")}>
              {manifest.author ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.version")}>
              {manifest.version}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.apiVersion")}>
              {manifest.apiVersion}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.requiredCapabilities")}>
              {manifest.requiredCapabilities.length > 0 ? (
                <Space size={[4, 4]} wrap>
                  {manifest.requiredCapabilities.map((capability) => (
                    <Tag key={capability}>{capability}</Tag>
                  ))}
                </Space>
              ) : (
                "—"
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.entry")}>
              {manifest.entry !== undefined ? (
                <Space size={4}>
                  {manifest.entry.web !== undefined ? (
                    <Tag color="blue">{t("plugins.entryWeb")}</Tag>
                  ) : null}
                  {manifest.entry.node !== undefined ? (
                    <Tag color="green">{t("plugins.entryNode")}</Tag>
                  ) : null}
                  <Typography.Text type="secondary">
                    {t("plugins.entryNotExecuted")}
                  </Typography.Text>
                </Space>
              ) : (
                "—"
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.permissions")}>
              {manifest.permissions.length > 0 ? (
                <Space size={[4, 4]} wrap>
                  {manifest.permissions.map((permission) => (
                    <Tag key={permission} color="geekblue">
                      {permissionLabel(t, permission)}
                    </Tag>
                  ))}
                </Space>
              ) : (
                "—"
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.platform")}>
              <Space size={4}>
                <Tag color={manifest.platform.web ? "blue" : "default"}>
                  {t("plugins.platformWeb")}
                </Tag>
                {manifest.platform.node ? (
                  <Tag color="green">{t("plugins.platformNode")}</Tag>
                ) : null}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </div>
      ),
      okText: t("plugins.installConfirmOk"),
      cancelText: t("connection.cancel"),
      okButtonProps: { danger: true },
      onOk: () => {
        const result = registry.register(manifest, { source: "installed" });
        if (!result.ok) {
          message.error(t(result.error.userMessageKey));
          return;
        }
        message.success(t("plugins.installSuccess"));
        forceRender((v) => v + 1);
      },
    });
  };

  /** 安装入口：按能力矩阵路由——file=桌面端文件对话框 / upload=浏览器客户端文件选择。 */
  const handleInstallClick = async (): Promise<void> => {
    if (host === null) return;
    const capability = host.capabilities.pluginInstall;
    if (capability === "unsupported") {
      message.error(t("plugins.installUnsupported"));
      return;
    }
    if (capability === "file") {
      const result = await host.openTextFile({
        suggestedName: "plugin-manifest.json",
      });
      if (!result.ok) {
        message.error(t(result.error.userMessageKey));
        return;
      }
      const content = result.value.content;
      if (content === null) {
        // 用户取消打开对话框：非错误。
        return;
      }
      handlePluginFileText(content);
      return;
    }
    // upload：浏览器客户端文件选择（隐藏 input）。
    fileInputRef.current?.click();
  };

  const handleFileInput = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    // 允许重复选择同一文件。
    event.target.value = "";
    if (file === undefined) return;
    void file.text().then(handlePluginFileText);
  };

  /**
   * 卸载插件（ADR-044 Phase F-1）：仅 installed 来源显示按钮；确认 →
   * registry.unregister（回收贡献点 + 持久化删除，由 PluginPersistenceCoordinator 承担）。
   */
  const handleUninstall = (pluginId: string): void => {
    if (registry === null) return;
    void modal.confirm({
      title: t("plugins.uninstallConfirmTitle"),
      content: (
        <Typography.Paragraph type="secondary">
          {t("plugins.uninstallConfirmWarning")}
        </Typography.Paragraph>
      ),
      okText: t("plugins.uninstallConfirmOk"),
      cancelText: t("connection.cancel"),
      okButtonProps: { danger: true },
      onOk: () => {
        const result = registry.unregister(pluginId);
        if (!result.ok) {
          message.error(t(result.error.userMessageKey));
          return;
        }
        message.success(t("plugins.uninstallSuccess"));
        forceRender((v) => v + 1);
      },
    });
  };

  /**
   * 恢复随应用分发插件（2026-09-02 插件外部化）：用户卸载后经此处重新安装
   * （host.restoreBundledPlugin：register + 持久化，已注册的自动跳过）。
   */
  const handleRestoreBundled = (): void => {
    if (host === null) return;
    void host.restoreAllBundledPlugins().then(() => {
      message.success(t("plugins.restoreBundledSuccess"));
      forceRender((v) => v + 1);
    });
  };

  return (
    <Modal
      title={t("plugins.title")}
      open={open}
      onCancel={() => setOpen(false)}
      footer={
        <Flex justify="flex-end" gap={8}>
          <Button icon={<ReloadOutlined />} onClick={handleRestoreBundled}>
            {t("plugins.restoreBundled")}
          </Button>
          <Button icon={<UploadOutlined />} onClick={handleInstallClick}>
            {t("plugins.install")}
          </Button>
        </Flex>
      }
    >
      {host?.capabilities.pluginInstall === "upload" ? (
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.mjs,application/json,text/javascript"
          style={{ display: "none" }}
          onChange={handleFileInput}
          data-testid="plugin-manifest-file-input"
        />
      ) : null}
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
                  {registry?.getSource(plugin.id) === "installed" ? (
                    <Tag color="green">{t("plugins.installedTag")}</Tag>
                  ) : null}
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
              <Flex align="center" gap={4}>
                {registry?.getSource(plugin.id) === "installed" ? (
                  <Tooltip title={t("plugins.uninstall")}>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleUninstall(plugin.id)}
                      aria-label={t("plugins.uninstall")}
                    />
                  </Tooltip>
                ) : null}
                <Switch
                  size="small"
                  checked={registry?.isEnabled(plugin.id) ?? false}
                  onChange={(checked) => {
                    registry?.setEnabled(plugin.id, checked);
                    forceRender((v) => v + 1);
                  }}
                />
              </Flex>
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
