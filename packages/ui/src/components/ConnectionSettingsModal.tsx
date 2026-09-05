import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Col,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Switch,
  Tag,
  Typography,
} from "antd";
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
import type {
  SerialDeviceHandle,
  SerialPortOption,
} from "@mamep2026/platform-api";
import { useAppStore } from "../app-store";
import { usePluginContributions } from "../plugin/use-contributions";
import {
  protocolForSheetType,
  type TableTypeContribution,
} from "../plugin/plugin-registries";
import {
  extractPersistedSettings,
  profileToValues,
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

export function ConnectionSettingsModal(): React.ReactNode {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.connectionModalOpen);
  const setOpen = useAppStore((s) => s.setConnectionModalOpen);
  const setConnectionSettings = useAppStore((s) => s.setConnectionSettings);
  const host = useAppStore((s) => s.host);
  const workspace = useAppStore((s) => s.workspace);
  const connectionState = useAppStore((s) => s.connectionState);
  // 已连接判定语义与顶栏 connection-cluster 一致（仅 connected 视为已连接）。
  const connected = connectionState === "connected";
  const [selectedHandle, setSelectedHandle] =
    useState<SerialDeviceHandle | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // enumerated 模式（Electron）：端口下拉框状态。
  const [portOptions, setPortOptions] = useState<SerialPortOption[]>([]);
  const [selectedPortId, setSelectedPortId] = useState<string | null>(null);
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
  // 默认表单值跟随存储 profile 的协议（重开弹窗恢复上次选择的协议与参数）。
  const defaultProfile = storedProfile ?? createDefaultRtuProfile();
  const { control, handleSubmit, reset, getValues } =
    useForm<ConnectionSettingsValues>({
      resolver: zodResolver(settingsSchema),
      defaultValues: profileToValues(defaultProfile),
    });
  // 当前协议（Segmented 选择）：RTU/TCP 表单互斥展示；浏览器能力门控隐藏 TCP 入口。
  const protocol = useWatch({ control, name: "protocol" }) ?? "rtu";
  const supportsTcp = host?.capabilities.modbusTcp ?? false;
  const supportsRtu = host?.capabilities.modbusRtu ?? true;
  // 浏览器仅支持 RTU：协议 Segmented 单选项冗余 → 隐藏「协议」分组；桌面端两类都有则保留切换（2026-09-06）。
  const showProtocolSwitcher = (supportsRtu ? 1 : 0) + (supportsTcp ? 1 : 0) > 1;

  const supportsSerial = host?.supportsWebSerial() ?? false;
  const isMock = host?.isMockMode ?? false;
  const serialPorts = host?.capabilities.serialPorts ?? "unsupported";
  const isEnumerated = serialPorts === "enumerated";
  // 浏览器兼容性（PRD §8.3 / §15.7）：检测失败时明确提示替代方案并禁用 CONNECT，
  // 禁止执行不可用的串口操作，但工作区仍可查看。
  const compat = host?.browserCompatibility ?? null;
  const serialBlocked = !isMock && !supportsSerial && !isEnumerated;

  // 连接协议由活动表类型决定（ADR-041 决策 A）：核心表 → rtu；安川表 → codec 协议。
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
    if (host === null || host === undefined) return [];
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
    if (host === null || host === undefined) return;
    const result = await host.selectSerialPort(portId ?? null);
    if (result.ok && result.value !== null) {
      setSelectedHandle(result.value);
      setSelectedPortId(portId ?? null);
      setConnectError(null);
    } else if (result.ok) {
      // 用户取消/未选择：清空当前选择。
      setSelectedHandle(null);
      setSelectedPortId(null);
    } else {
      setConnectError(
        `${t(result.error.userMessageKey)} (${result.error.technicalMessage})`,
      );
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (host === null || host === undefined) return;
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
      const result =
        values.protocol === "tcp"
          ? await host.connectTcp(
              toProfile(values, tcpBase) as TcpConnectionProfile,
            )
          : await host.connect(
              toProfile(values, profile) as RtuConnectionProfile,
              isMock ? null : selectedHandle,
              { protocol: sheetProtocol },
            );
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
      onCancel={() => setOpen(false)}
      afterOpenChange={(nextOpen) => {
        if (nextOpen) {
          // 每次打开：恢复上次持久化的连接设置（含端口参数/协议）；串口/端口选择保持待选。
          // 注意：不在弹窗打开时自动枚举——navigator.serial.requestPort() 必须在用户
          // 手势（点击下拉框/刷新按钮）中调用，否则抛 SecurityError（刷不出串口）。
          reset(profileToValues(defaultProfile));
          setConnectError(null);
        } else {
          // 关闭（手动取消 / Connect 成功后自动关闭）时持久化连接设置（串口选择除外）。
          const values = getValues();
          setConnectionSettings(extractPersistedSettings(values));
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
          disabled={!connected && serialBlocked}
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
      <Form layout="vertical" size="small">
        <Controller
          name="protocol"
          control={control}
          render={({ field }) =>
            showProtocolSwitcher ? (
              <Form.Item
                label={t("connection.protocol")}
                style={{ marginBottom: 12 }}
              >
                <Segmented
                  block
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                  options={[
                    ...(supportsRtu
                      ? [
                          {
                            label: t("connection.protocolRtu"),
                            value: "rtu" as const,
                          },
                        ]
                      : []),
                    ...(supportsTcp
                      ? [
                          {
                            label: t("connection.protocolTcp"),
                            value: "tcp" as const,
                          },
                        ]
                      : []),
                  ]}
                />
              </Form.Item>
            ) : (
              // 浏览器仅支持 RTU：隐藏「协议」分组，但保留隐藏 input 注册字段（保持 protocol 值稳定）。
              <input type="hidden" {...field} />
            )
          }
        />
        {protocol === "rtu" ? (
          <>
            <Divider
              titlePlacement="left"
              plain
              style={{ marginTop: 0, marginBottom: 8 }}
            >
              {t("connection.groupCommunication")}
            </Divider>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={t("connection.port")}>
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
                </Form.Item>
                <Controller
                  name="baudRate"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.baudRate")}>
                      <Select
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[
                          1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
                        ].map((v) => ({ value: v, label: String(v) }))}
                      />
                    </Form.Item>
                  )}
                />
                <Controller
                  name="dataBits"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.dataBits")}>
                      <Select
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[7, 8].map((v) => ({
                          value: v,
                          label: `${v} BIT`,
                        }))}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="stopBits"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.stopBits")}>
                      <Select
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[1, 2].map((v) => ({
                          value: v,
                          label: `${v} BIT`,
                        }))}
                      />
                    </Form.Item>
                  )}
                />
                <Controller
                  name="parity"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.parity")}>
                      <Select
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[
                          { value: "none", label: t("connection.parityNone") },
                          { value: "even", label: t("connection.parityEven") },
                          { value: "odd", label: t("connection.parityOdd") },
                        ]}
                      />
                    </Form.Item>
                  )}
                />
                <Controller
                  name="flowControl"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.flowControl")}>
                      <Select
                        style={{ width: "100%" }}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        options={[
                          { value: "off", label: t("connection.flowOff") },
                          {
                            value: "rts-cts",
                            label: t("connection.flowRtsCts"),
                          },
                        ]}
                      />
                    </Form.Item>
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
                  name="rxDelay"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.rxDelay")}>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={0}
                        max={5000}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 50)}
                      />
                    </Form.Item>
                  )}
                />
                <Controller
                  name="timeout"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.timeout")}>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={50}
                        max={60000}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 1000)}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="retry"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.retry")}>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={0}
                        max={10}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 1)}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
            </Row>
          </>
        ) : null}
        {protocol === "tcp" ? (
          <>
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
                    <Form.Item label={t("connection.host")}>
                      <Input
                        placeholder="192.168.1.10"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="port"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.portTcp")}>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={1}
                        max={65535}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 502)}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="unitId"
                  control={control}
                  render={({ field }) => (
                    <Form.Item
                      label={t("connection.unitId")}
                      tooltip={t("connection.unitIdHint")}
                    >
                      <InputNumber
                        style={{ width: "100%" }}
                        min={0}
                        max={255}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 0)}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="timeout"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.timeout")}>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={50}
                        max={60000}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 1000)}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
              <Col span={12}>
                <Controller
                  name="retry"
                  control={control}
                  render={({ field }) => (
                    <Form.Item label={t("connection.retry")}>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={0}
                        max={10}
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? 1)}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
              <Col span={24}>
                <Controller
                  name="autoReconnect"
                  control={control}
                  render={({ field }) => (
                    <Form.Item
                      label={t("connection.autoReconnect")}
                      tooltip={t("connection.autoReconnectHint")}
                    >
                      {/* 自动重连：PRD §8.3 P1（2026-08-30 落地，有限次数 + 指数退避）。 */}
                      <Switch
                        checked={field.value}
                        onChange={(checked) => field.onChange(checked)}
                      />
                    </Form.Item>
                  )}
                />
              </Col>
            </Row>
          </>
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
      </Form>
    </Modal>
  );
}
