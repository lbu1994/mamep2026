/**
 * 插件管理区块，嵌入 Settings 抽屉的「Plugins」页签。
 * 插件管理统一从 Settings 进入。
 *
 * 功能与行为（安装卸载与隔离手动安装 + 同进程授权）：安装
 * （manifest JSON 或单文件 JS）、启用/禁用、卸载（仅 installed）、加载错误展示；
 * 安装/卸载确认继续用 `App.useApp().modal.confirm`（渲染到 body portal，不受 Drawer 影响）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { App as AntApp } from "antd";
import Button from "antd/es/button";
import Descriptions from "antd/es/descriptions";
import Empty from "antd/es/empty";
import Flex from "antd/es/flex";
import Listy from "antd/es/listy";
import Space from "antd/es/space";
import Switch from "antd/es/switch";
import Tag from "antd/es/tag";
import Tooltip from "antd/es/tooltip";
import Typography from "antd/es/typography";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import {
  PERMISSION_LABEL_KEYS,
  pluginManifestSchema,
  getRequiredPluginExecution,
  type PermissionId,
} from "@mamep2026/plugin-api";
import { useAppStore } from "../app-store";

/** 权限 → i18n 标签键映射：共享自 plugin-api，未登记权限回退显示原始字符串。 */
function permissionLabel(
  t: (key: string) => string,
  permission: PermissionId,
): string {
  const labelKey = PERMISSION_LABEL_KEYS[permission];
  return labelKey !== undefined ? t(labelKey) : permission;
}

export function PluginManagerSection({
  active = true,
}: {
  active?: boolean;
}): React.ReactNode {
  const { t } = useTranslation();
  const { message, modal } = AntApp.useApp();
  const host = useAppStore((s) => s.host);
  const registry = host?.pluginRegistry ?? null;
  useSyncExternalStore(
    (listener) => registry?.subscribe(listener) ?? (() => {}),
    () => registry?.getVersion() ?? 0,
  );
  const [reloading, setReloading] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeHostRef = useRef<typeof host>(null);
  const installationRef = useRef<{
    controller: AbortController;
    destroy?: () => void;
  } | null>(null);

  // Closing settings or replacing the host cancels loading and removes its dialog.
  useEffect(() => {
    activeHostRef.current = active ? host : null;
    return () => {
      activeHostRef.current = null;
      const installation = installationRef.current;
      installationRef.current = null;
      installation?.controller.abort();
      installation?.destroy?.();
    };
  }, [active, host]);

  const plugins = registry?.list() ?? [];
  const loadErrors = registry?.getLoadErrors() ?? [];
  const hostError = registry?.getHostError();

  /**
   * 单文件 JS 插件安装：entry 含 manifest + activate。
   * 1) 预览（按隔离模式加载 entry 提取 manifest，**不注册**）；
   * 2) Show the declared requirements and request consent before execution.
   * 3) Install using the declared mode only after the user confirms.
   */
  const handlePluginSourceText = async (text: string): Promise<void> => {
    if (registry === null || host === null || activeHostRef.current !== host)
      return;
    if (!host.capabilities.executablePlugins) {
      message.error(t("plugins.executableUnsupported"));
      return;
    }
    installationRef.current?.controller.abort();
    installationRef.current?.destroy?.();
    const installation: NonNullable<typeof installationRef.current> = {
      controller: new AbortController(),
    };
    installationRef.current = installation;
    const { signal } = installation.controller;
    const preview = await host.previewPluginEntry(text, "isolated", signal);
    if (signal.aborted) return;
    if (!preview.ok) {
      message.error(t(preview.error.userMessageKey));
      return;
    }
    const manifest = preview.value;
    const executionMode = getRequiredPluginExecution(manifest);
    const requiresSameProcess = executionMode === "same-process";
    const dialog = modal.confirm({
      title: t("plugins.installConfirmTitle"),
      content: (
        <div>
          <Typography.Paragraph type="secondary">
            {t("plugins.installConfirmWarning")}
          </Typography.Paragraph>
          {requiresSameProcess ? (
            <Typography.Paragraph type="warning">
              {t("plugins.executionModeWarning")}
            </Typography.Paragraph>
          ) : (
            <Typography.Paragraph>
              {t("plugins.entryIsolated")}
            </Typography.Paragraph>
          )}
          {manifest.executionRequirements?.reason !== undefined ? (
            <Typography.Paragraph>
              {t("plugins.executionReason", {
                reason: manifest.executionRequirements.reason,
              })}
            </Typography.Paragraph>
          ) : null}
          <Descriptions column={1} size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label={t("plugins.name")}>
              <Typography.Text strong>{manifest.name}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.author")}>
              {manifest.author ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("plugins.version")}>
              {manifest.version}
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
      okText: t(
        requiresSameProcess
          ? "plugins.authorizeSameProcess"
          : "plugins.installConfirmOk",
      ),
      cancelText: t("connection.cancel"),
      okButtonProps: { danger: true },
      onCancel: () => installation.controller.abort(),
      afterClose: () => {
        installation.controller.abort();
        if (installationRef.current === installation)
          installationRef.current = null;
      },
      onOk: async () => {
        if (signal.aborted) return;
        const result = await host.installPluginEntry(text, executionMode);
        if (signal.aborted) return;
        if (!result.ok) {
          message.error(t(result.error.userMessageKey));
          return;
        }
        message.success(t("plugins.installSuccess"));
        forceRender((v) => v + 1);
      },
    });
    installation.destroy = () => dialog.destroy();
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
   * 卸载插件：仅 installed 来源显示按钮；确认 →
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

  return (
    <div className="plugin-manager" data-testid="plugin-manager">
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Flex justify="flex-end" gap={8}>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={handleInstallClick}
          >
            {t("plugins.install")}
          </Button>
        </Flex>
        {host?.capabilities.pluginInstall === "upload" ? (
          <input
            ref={fileInputRef}
            type="file"
            // 仅按扩展名过滤：部分 ROM 的文件选择器按 MIME 过滤，把
            // `.mjs` 归为 application/octet-stream 而不可选；放宽为扩展名可规避，
            // 文件内容仍经清单 schema 校验（选错文件有结构化错误提示）。
            accept=".json,.mjs,.js"
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
                  {registry?.getHostState(plugin.id) !== undefined ? (
                    <div data-testid={`host-plugin-state-${plugin.id}`}>
                      <Tag>
                        {t(
                          `plugins.hostStage.${registry.getHostState(plugin.id)?.stage}`,
                        )}
                      </Tag>
                      {registry
                        .getHostState(plugin.id)
                        ?.errors.map((error, index) => (
                          <Typography.Paragraph key={index} type="danger">
                            [{error.code}] {error.technicalMessage}
                          </Typography.Paragraph>
                        ))}
                    </div>
                  ) : null}
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
                  {registry?.getHostState(plugin.id)?.stage === "failed" &&
                  host?.reloadHostPlugin !== undefined ? (
                    <Button
                      size="small"
                      loading={reloading === plugin.id}
                      disabled={
                        reloading !== null || !registry.isEnabled(plugin.id)
                      }
                      onClick={async () => {
                        setReloading(plugin.id);
                        try {
                          const result = await host.reloadHostPlugin?.(
                            plugin.id,
                          );
                          if (result !== undefined && !result.ok)
                            message.error(t(result.error.userMessageKey));
                        } finally {
                          setReloading(null);
                        }
                      }}
                    >
                      {t("plugins.reloadHost")}
                    </Button>
                  ) : null}
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
                  {registry?.getEntrySource(plugin.id) !== null &&
                  !registry?.isEnabled(plugin.id) ? (
                    <Button
                      size="small"
                      onClick={() => {
                        const source = registry?.getEntrySource(plugin.id);
                        if (source != null) void handlePluginSourceText(source);
                      }}
                    >
                      {t("plugins.confirmPermissions")}
                    </Button>
                  ) : null}
                  <Switch
                    size="small"
                    checked={registry?.isEnabled(plugin.id) ?? false}
                    onChange={async (checked) => {
                      const result = await host?.setPluginEnabled(
                        plugin.id,
                        checked,
                      );
                      if (result !== undefined && !result.ok)
                        message.error(t(result.error.userMessageKey));
                      forceRender((v) => v + 1);
                    }}
                  />
                </Flex>
              </Flex>
            )}
          />
        )}
        {hostError ? (
          <Typography.Paragraph type="danger">
            [{hostError.code}] {hostError.technicalMessage}
          </Typography.Paragraph>
        ) : null}
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
      </Space>
    </div>
  );
}
