import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Alert from "antd/es/alert";
import Badge from "antd/es/badge";
import Button from "antd/es/button";
import ConfigProvider from "antd/es/config-provider";
import Col from "antd/es/col";
import Divider from "antd/es/divider";
import Flex from "antd/es/flex";
import Input from "antd/es/input";
import InputNumber from "antd/es/input-number";
import Modal from "antd/es/modal";
import Row from "antd/es/row";
import Segmented from "antd/es/segmented";
import Select from "antd/es/select";
import Switch from "antd/es/switch";
import Tag from "antd/es/tag";
import Typography from "antd/es/typography";
import {
  ApiOutlined,
  CloseOutlined,
  DisconnectOutlined,
  ReloadOutlined,
  UsbOutlined,
} from "@ant-design/icons";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  type RtuConnectionProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import type { ConnectionState } from "@mamep2026/communication";
import {
  serialParameterSupport,
  type SerialPortOption,
} from "@mamep2026/platform-api";
import { getConnectionSupportError } from "../connection-support";
import { useAppStore } from "../app-store";
import { runConnect } from "../connection-actions";
import { usePluginContributions } from "../plugin/use-contributions";
import {
  protocolForSheetType,
  type TableTypeContribution,
} from "../plugin/plugin-registries";
import {
  extractPersistedSettings,
  profileToValues,
  RTU_TIMEOUT_OPTIONS,
  settingsSchema,
  toProfile,
  type ConnectionSettingsValues,
} from "./connection-settings-model";

/**
 * 连接状态 → Badge 语义色。
 * 模态框在 portal 中渲染，antd 组件自身 token 可靠；不沿用顶栏 STATE_DOT_COLOR
 * 的 var(--ant-*) 内联样式，避免 portal 内 CSS 变量解析失效。
 */
const STATE_BADGE_STATUS: Record<
  ConnectionState,
  "success" | "processing" | "warning" | "error" | "default"
> = {
  disconnected: "default",
  "selecting-device": "processing",
  connecting: "processing",
  connected: "success",
  disconnecting: "processing",
  "reconnect-waiting": "processing",
  reconnecting: "processing",
  interrupted: "warning",
  failed: "error",
};

/** 表单字段容器：连接设置在懒加载 chunk 内使用原生布局，避免把 antd Form/校验器带入共享包。 */
function ConnectionField({
  label,
  hint,
  compact = false,
  children,
}: {
  label: string;
  hint?: string;
  compact?: boolean;
  children: ReactNode;
}): React.ReactNode {
  return (
    <div
      className="ant-form-item connection-settings__field"
      style={{ marginBottom: compact ? 12 : 24 }}
    >
      <div
        title={hint}
        style={{
          color: "var(--ant-color-text-heading)",
          marginBottom: 8,
        }}
      >
        {label}
        {hint !== undefined ? (
          <span
            aria-hidden="true"
            style={{ cursor: "help", marginInlineStart: 4 }}
          >
            ?
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function ConnectionSettingsModal(): React.ReactNode {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.connectionModalOpen);
  const setOpen = useAppStore((s) => s.setConnectionModalOpen);
  const setConnectionSettings = useAppStore((s) => s.setConnectionSettings);
  const host = useAppStore((s) => s.host);
  const workspace = useAppStore((s) => s.workspace);
  const connectionState = useAppStore((s) => s.connectionState);
  // 会话内已选串口 / 端口 ID / 连接错误（Header Connect 直连：提升到 store 供 Header 判定/回退展示）。
  const selectedHandle = useAppStore((s) => s.selectedSerialHandle);
  const selectedPortId = useAppStore((s) => s.selectedSerialPortId);
  const connectError = useAppStore((s) => s.connectError);
  const setSerialSelection = useAppStore((s) => s.setSerialSelection);
  const setConnectError = useAppStore((s) => s.setConnectError);
  const pluginsReady = useAppStore((s) => s.pluginsReady);
  // 已连接判定语义与顶栏 connection-cluster 一致（仅 connected 视为已连接）。
  const connected = connectionState === "connected";
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // enumerated 模式（Electron）：端口下拉框状态。
  const [portOptions, setPortOptions] = useState<SerialPortOption[]>([]);
  const [enumerating, setEnumerating] = useState(false);

  // 持久化的首个 profile（RTU 或 TCP）：作为对应协议表单的基础值。
  const storedProfile = workspace.connectionProfiles[0];
  const profile =
    storedProfile !== undefined && storedProfile.protocol === "rtu"
      ? storedProfile
      : createDefaultRtuProfile();
  const tcpBase: TcpConnectionProfile =
    storedProfile !== undefined && storedProfile.protocol === "tcp"
      ? storedProfile
      : createDefaultTcpProfile();
  const supportsTcp = host?.capabilities.modbusTcp ?? false;
  const supportsRtu = host?.capabilities.modbusRtu ?? true;
  // Preserve stored values even when the current platform cannot use them.
  const defaultProfile = storedProfile ?? (supportsRtu ? profile : tcpBase);
  const { control, handleSubmit, reset, getValues } =
    useForm<ConnectionSettingsValues>({
      resolver: zodResolver(settingsSchema),
      defaultValues: profileToValues(defaultProfile),
    });
  const values = useWatch({ control });
  const protocol = values.protocol ?? defaultProfile.protocol;
  const serialSupport = serialParameterSupport[host?.platform ?? "browser"];
  const currentValues = { ...profileToValues(defaultProfile), ...values };
  const supportError =
    host == null
      ? null
      : getConnectionSupportError(
          host,
          toProfile(currentValues, protocol === "tcp" ? tcpBase : profile),
        );

  const supportsSerial = host?.supportsWebSerial() ?? false;
  const isMock = host?.isMockMode ?? false;
  const serialPorts = host?.capabilities.serialPorts ?? "unsupported";
  const isEnumerated = serialPorts === "enumerated";
  // 浏览器兼容性（PRD §8.3 / §15.7）：检测失败时明确提示替代方案并禁用 CONNECT，
  // 禁止执行不可用的串口操作，但工作区仍可查看。
  const compat = host?.browserCompatibility ?? null;
  // 串口缺失只影响 RTU：平台仅支持 TCP 时（Android）不得因此禁用 CONNECT。
  const serialBlocked =
    !isMock && !supportsSerial && !isEnumerated && protocol === "rtu";

  // 连接协议由活动表类型决定：核心表 → rtu；安川表 → codec 协议。
  // tableType 贡献（插件声明）提供 表类型 → protocolId 映射；协议不在平台能力矩阵内回退 rtu。
  const tableTypeContributions = usePluginContributions<TableTypeContribution>(
    host,
    "tableType",
  );
  const activeSheetType =
    workspace.sheets.find((sheet) => sheet.sheetId === workspace.activeSheetId)
      ?.type ?? "holding-register";
  const sheetProtocol = protocolForSheetType(
    activeSheetType,
    tableTypeContributions,
    host?.capabilities.protocolExtensions ?? [],
  );

  /** enumerated：枚举可用串口（打开弹窗 / 点击刷新时调用）；返回端口列表（供配置自动匹配）。 */
  const enumeratePorts = async (): Promise<SerialPortOption[]> => {
    if (host == null || !supportsRtu || protocol !== "rtu" || serialBlocked)
      return [];
    setEnumerating(true);
    try {
      const result = await host.enumerateSerialPorts();
      if (result.ok) {
        setPortOptions(result.value);
        setConnectError(null);
        return result.value;
      }
      return [];
    } finally {
      setEnumerating(false);
    }
  };

  const selectPort = async (portId?: string | null): Promise<void> => {
    if (host == null || !supportsRtu || protocol !== "rtu" || serialBlocked)
      return;
    const result = await host.selectSerialPort(portId ?? null);
    if (result.ok && result.value !== null) {
      setSerialSelection(result.value, portId ?? null);
      setConnectError(null);
    } else if (result.ok) {
      // 用户取消/未选择：清空当前选择。
      setSerialSelection(null, null);
    } else {
      setConnectError(
        `${t(result.error.userMessageKey)} (${result.error.technicalMessage})`,
      );
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (host === null || host === undefined || !pluginsReady) return;
    const error = getConnectionSupportError(
      host,
      toProfile(values, values.protocol === "tcp" ? tcpBase : profile),
    );
    if (error !== null || serialBlocked) return;
    // 需要选口（仅 RTU）：浏览器 picker（supportsSerial）或 enumerated 下拉（VSCode/Electron）均须先选。
    if (
      values.protocol !== "tcp" &&
      !isMock &&
      selectedHandle === null &&
      (supportsSerial || isEnumerated)
    ) {
      setConnectError(t("connection.selectDeviceFirst"));
      return;
    }
    setConnectError(null);
    setConnecting(true);
    try {
      const result = await runConnect(host, {
        protocol: values.protocol,
        profile:
          values.protocol === "tcp"
            ? (toProfile(values, tcpBase) as TcpConnectionProfile)
            : (toProfile(values, profile) as RtuConnectionProfile),
        sheetProtocol,
        handle: selectedHandle,
        isMock,
      });
      if (result.ok) {
        setOpen(false);
      } else {
        setConnectError(
          `${t(result.error.userMessageKey)} (${result.error.technicalMessage})`,
        );
      }
    } finally {
      setConnecting(false);
    }
  });

  const onDisconnect = async (): Promise<void> => {
    if (host === null || host === undefined) return;
    setConnectError(null);
    setDisconnecting(true);
    try {
      const result = await host.disconnect();
      if (!result.ok) {
        setConnectError(
          `${t(result.error.userMessageKey)} (${result.error.technicalMessage})`,
        );
      }
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Modal
      title={t("connection.title")}
      open={open}
      width={640}
      styles={{
        body: { maxHeight: "calc(100dvh - 240px)", overflowY: "auto" },
      }}
      onCancel={() => setOpen(false)}
      afterOpenChange={(nextOpen) => {
        if (nextOpen) {
          // 每次打开：恢复上次持久化的连接设置（含端口参数/协议）；串口/端口选择保持待选。
          // 注意：不在弹窗打开时自动枚举——navigator.serial.requestPort() 必须在用户
          // 手势（点击下拉框/刷新按钮）中调用，否则抛 SecurityError（刷不出串口）。
          // 注意：此处不清 connectError——Header 直连失败会先写 error 再打开弹窗，
          // 清空会丢失回退展示；错误在关闭时清（下次正常打开时已是干净态）。
          reset(profileToValues(defaultProfile));
        } else {
          // 关闭（手动取消 / Connect 成功后自动关闭）时持久化连接设置（串口选择除外）。
          const values = getValues();
          setConnectionSettings(extractPersistedSettings(values));
          setConnectError(null);
          // enumerated：未完成选择就关闭 → 取消挂起的选择会话（避免 requestPort 悬挂）。
          if (isEnumerated && selectedPortId === null) {
            void host?.selectSerialPort(null).catch(() => undefined);
          }
        }
      }}
      footer={[
        <Button
          key="cancel"
          icon={<CloseOutlined />}
          onClick={() => setOpen(false)}
        >
          {t("connection.cancel")}
        </Button>,
        <Button
          key="connect"
          type={connected ? "default" : "primary"}
          danger={connected}
          loading={connecting || disconnecting}
          disabled={
            !connected &&
            (serialBlocked || supportError !== null || !pluginsReady)
          }
          icon={connected ? <DisconnectOutlined /> : <ApiOutlined />}
          onClick={() => {
            if (connected) {
              void onDisconnect();
            } else {
              void onSubmit();
            }
          }}
        >
          {connected ? t("connection.disconnect") : t("connection.connect")}
        </Button>,
      ]}
    >
      {serialBlocked ? (
        <Typography.Paragraph type="warning">
          {t("connection.unsupportedWebSerial")}
          {compat?.issues.includes("insecure-context") === true ? (
            <>
              <br />
              {t("connection.unsupportedSecureContext")}
            </>
          ) : null}
          <br />
          {t("connection.unsupportedWebSerialHint")}
        </Typography.Paragraph>
      ) : null}
      <div>
        <Controller
          name="protocol"
          control={control}
          render={({ field }) => (
            <ConnectionField label={t("connection.protocol")} compact>
              <Segmented
                block
                value={field.value}
                onChange={(value) => {
                  if (
                    (value === "rtu" && supportsRtu) ||
                    (value === "tcp" && supportsTcp)
                  )
                    field.onChange(value);
                }}
                options={[
                  {
                    label: t("connection.protocolRtu"),
                    value: "rtu",
                    disabled: !supportsRtu,
                  },
                  {
                    label: t("connection.protocolTcp"),
                    value: "tcp",
                    disabled: !supportsTcp,
                  },
                ]}
              />
            </ConnectionField>
          )}
        />
        {!supportsRtu || !supportsTcp ? (
          <Typography.Paragraph type="secondary">
            {t("connection.protocolUnsupported")}
          </Typography.Paragraph>
        ) : null}
        <ConfigProvider
          componentDisabled={
            !supportsRtu || protocol !== "rtu" || serialBlocked
          }
        >
          <section aria-label={t("connection.protocolRtu")}>
            <Divider
              titlePlacement="left"
              plain
              style={{ marginTop: 0, marginBottom: 8 }}
            >
              {t("connection.groupCommunication")}
            </Divider>
            <Row gutter={16}>
              <Col span={12}>
                <ConnectionField label={t("connection.port")}>
                  {isMock ? (
                    <Tag>{t("connection.portMock")}</Tag>
                  ) : isEnumerated ? (
                    <Flex gap={8} align="center">
                      <Select
                        style={{ flex: 1 }}
                        placeholder={t("connection.portSelectPlaceholder")}
                        loading={enumerating}
                        value={selectedPortId ?? undefined}
                        // 用户点开下拉框即枚举（用户手势，满足 requestPort 的权限要求）。
                        // 注：antd v6 用 onOpenChange（onDropdownVisibleChange 已弃用）。
                        onOpenChange={(open) => {
                          if (open) void enumeratePorts();
                        }}
                        notFoundContent={
                          <Flex
                            vertical
                            align="center"
                            gap={4}
                            style={{ padding: "8px 0" }}
                          >
                            <Typography.Text type="secondary">
                              {t("connection.portEmpty")}
                            </Typography.Text>
                            <Button
                              size="small"
                              icon={<ReloadOutlined />}
                              onClick={() => void enumeratePorts()}
                            >
                              {t("connection.portRefresh")}
                            </Button>
                          </Flex>
                        }
                        options={portOptions.map((p) => ({
                          value: p.portId,
                          label: p.label,
                        }))}
                        onChange={(portId) => void selectPort(portId)}
                      />
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => void enumeratePorts()}
                        title={t("connection.portRefresh")}
                      />
                    </Flex>
                  ) : (
                    <Flex gap={8} align="center">
                      <Button
                        icon={<UsbOutlined />}
                        onClick={() => void selectPort()}
                      >
                        {t("connection.portSelect")}
                      </Button>
                      {selectedHandle !== null ? (
                        <Tag style={{ marginInlineEnd: 0 }}>
                          {selectedHandle.label}
                        </Tag>
                      ) : null}
                    </Flex>
                  )}
                </ConnectionField>
                <Controller
                  name="baudRate"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.baudRate")}>
                      <Select
                        aria-label={t("connection.baudRate")}
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={Array.from(
                          new Set([...serialSupport.baudRates, field.value]),
                        ).map((v) => ({
                          value: v,
                          label: String(v),
                          disabled:
                            !serialSupport.customBaudRates &&
                            !serialSupport.baudRates.includes(v),
                        }))}
                      />
                    </ConnectionField>
                  )}
                />
                <Controller
                  name="dataBits"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.dataBits")}>
                      <Select
                        aria-label={t("connection.dataBits")}
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[7, 8].map((v) => ({
                          disabled: !serialSupport.dataBits.includes(v),
                          value: v,
                          label: `${v} BIT`,
                        }))}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="stopBits"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField
                      label={t("connection.stopBits")}
                      hint={t("connection.stopBitsUnsupported")}
                    >
                      <Select
                        aria-label={t("connection.stopBits")}
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[1, 1.5, 2].map((v) => ({
                          disabled: !serialSupport.stopBits.includes(v),
                          value: v,
                          label: `${v} BIT`,
                        }))}
                      />
                    </ConnectionField>
                  )}
                />
                <Controller
                  name="parity"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.parity")}>
                      <Select
                        aria-label={t("connection.parity")}
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[
                          { value: "none", label: t("connection.parityNone") },
                          { value: "even", label: t("connection.parityEven") },
                          { value: "odd", label: t("connection.parityOdd") },
                        ]}
                      />
                    </ConnectionField>
                  )}
                />
                <Controller
                  name="flowControl"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField
                      label={t("connection.flowControl")}
                      hint={t(
                        serialSupport.flowControl.includes("xon-xoff")
                          ? "connection.driverParametersHint"
                          : "connection.flowControlUnsupported",
                      )}
                    >
                      <Select
                        aria-label={t("connection.flowControl")}
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[
                          { value: "off", label: t("connection.flowOff") },
                          {
                            value: "rts-cts",
                            label: t("connection.flowRtsCts"),
                            disabled:
                              !serialSupport.flowControl.includes("rts-cts"),
                          },
                          {
                            value: "xon-xoff",
                            label: t("connection.flowXonXoff"),
                            disabled:
                              !serialSupport.flowControl.includes("xon-xoff"),
                          },
                        ]}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
            </Row>
            <Divider
              titlePlacement="left"
              plain
              style={{ marginTop: 16, marginBottom: 8 }}
            >
              {t("connection.groupOption")}
            </Divider>
            <Row gutter={16}>
              <Col span={12}>
                <Controller
                  name="rtuTimeout"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.timeout")}>
                      <Select
                        aria-label={t("connection.timeout")}
                        style={{ width: "100%" }}
                        showSearch
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        optionFilterProp="label"
                        options={RTU_TIMEOUT_OPTIONS.map((v) => ({
                          value: v,
                          label: `${v} ms`,
                        }))}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="retry"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.retry")}>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={0}
                        max={10}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 1)}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
            </Row>
          </section>
        </ConfigProvider>
        <ConfigProvider componentDisabled={!supportsTcp || protocol !== "tcp"}>
          <section aria-label={t("connection.protocolTcp")}>
            <Divider
              titlePlacement="left"
              plain
              style={{ marginTop: 16, marginBottom: 8 }}
            >
              {t("connection.groupTcp")}
            </Divider>
            <Row gutter={16}>
              <Col span={24}>
                <Controller
                  name="host"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.host")}>
                      <Input
                        aria-label={t("connection.host")}
                        placeholder="192.168.1.10"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="port"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.portTcp")}>
                      <InputNumber
                        aria-label={t("connection.portTcp")}
                        style={{ width: "100%" }}
                        min={1}
                        max={65535}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 502)}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="unitId"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField
                      label={t("connection.unitId")}
                      hint={t("connection.unitIdHint")}
                    >
                      <InputNumber
                        aria-label={t("connection.unitId")}
                        style={{ width: "100%" }}
                        min={0}
                        max={255}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 0)}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="tcpTimeout"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.timeout")}>
                      <InputNumber
                        aria-label={t("connection.timeout")}
                        style={{ width: "100%" }}
                        min={50}
                        max={60000}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 50)}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="retry"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField label={t("connection.retry")}>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={0}
                        max={10}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 1)}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
              <Col span={24}>
                <Controller
                  name="autoReconnect"
                  control={control}
                  render={({ field }) => (
                    <ConnectionField
                      label={t("connection.autoReconnect")}
                      hint={t("connection.autoReconnectHint")}
                    >
                      {/* 自动重连：PRD §8.3 P1（落地，有限次数 + 指数退避）。 */}
                      <Switch
                        checked={field.value}
                        onChange={(checked) => field.onChange(checked)}
                      />
                    </ConnectionField>
                  )}
                />
              </Col>
            </Row>
          </section>
        </ConfigProvider>
        {supportError !== null ? (
          <Alert
            type="warning"
            showIcon
            title={t(supportError.userMessageKey)}
            description={supportError.technicalMessage}
          />
        ) : null}
        {connectionState !== "disconnected" && connectionState !== "failed" ? (
          <div style={{ marginTop: 8 }}>
            <Badge
              status={STATE_BADGE_STATUS[connectionState]}
              text={t(`state.${connectionState}`)}
            />
          </div>
        ) : null}
        {connectError !== null ? (
          <Alert
            type="error"
            showIcon
            title={connectError}
            style={{ marginTop: 8 }}
          />
        ) : null}
      </div>
    </Modal>
  );
}
