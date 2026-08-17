import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Col,
  Form,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Typography,
} from "antd";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type { SerialDeviceHandle } from "@mamep2026/platform-api";
import { useAppStore } from "../app-store";
import {
  extractPersistedSettings,
  profileToValues,
  settingsSchema,
  toProfile,
  type ConnectionSettingsValues,
} from "./connection-settings-model";

export function ConnectionSettingsModal(): React.ReactNode {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.connectionModalOpen);
  const setOpen = useAppStore((s) => s.setConnectionModalOpen);
  const setConnectionSettings = useAppStore(
    (s) => s.setConnectionSettings,
  );
  const host = useAppStore((s) => s.host);
  const workspace = useAppStore((s) => s.workspace);
  const connectionState = useAppStore((s) => s.connectionState);
  const [selectedHandle, setSelectedHandle] =
    useState<SerialDeviceHandle | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const profile = workspace.connectionProfiles[0] ?? createDefaultRtuProfile();
  const { control, handleSubmit, reset, getValues } =
    useForm<ConnectionSettingsValues>({
      resolver: zodResolver(settingsSchema),
      defaultValues: profileToValues(profile),
    });

  const supportsSerial = host?.supportsWebSerial() ?? false;
  const isMock = host?.isMockMode ?? false;

  const selectPort = async (): Promise<void> => {
    if (host === null || host === undefined) return;
    const result = await host.selectSerialPort();
    if (result.ok && result.value !== null) {
      setSelectedHandle(result.value);
      setConnectError(null);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (host === null || host === undefined) return;
    if (!isMock && selectedHandle === null && supportsSerial) {
      setConnectError(t("connection.selectDeviceFirst"));
      return;
    }
    setConnectError(null);
    setConnecting(true);
    try {
      const nextProfile = toProfile(values, profile);
      const result = await host.connect(
        nextProfile,
        isMock ? null : selectedHandle,
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

  return (
    <Modal
      title={t("connection.title")}
      open={open}
      width={640}
      onCancel={() => setOpen(false)}
      afterOpenChange={(nextOpen) => {
        if (nextOpen) {
          // 每次打开：恢复上次持久化的连接设置（含端口参数）；串口/端口选择保持待选。
          reset(profileToValues(profile));
          setConnectError(null);
        } else {
          // 关闭（手动取消 / Connect 成功后自动关闭）时持久化连接设置（串口选择除外）。
          const values = getValues();
          setConnectionSettings(extractPersistedSettings(values));
        }
      }}
      footer={[
        <Button key="cancel" onClick={() => setOpen(false)}>
          {t("connection.cancel")}
        </Button>,
        <Button
          key="connect"
          type="primary"
          loading={connecting}
          onClick={() => void onSubmit()}
        >
          {t("connection.connect")}
        </Button>,
      ]}
    >
      {!isMock && !supportsSerial ? (
        <Typography.Paragraph type="warning">
          {t("connection.unsupportedWebSerial")}
        </Typography.Paragraph>
      ) : null}
      <Form layout="vertical" size="small">
        <Row gutter={16}>
          <Col span={12}>
            <div className="connection-settings-group">
              {t("connection.groupCommunication")}
            </div>
            <Form.Item label={t("connection.port")}>
              {isMock ? (
                <Typography.Text strong>
                  {t("connection.portMock")}
                </Typography.Text>
              ) : (
                <Space>
                  <Button onClick={() => void selectPort()}>
                    {t("connection.portSelect")}
                  </Button>
                  <Typography.Text>
                    {selectedHandle?.label ?? ""}
                  </Typography.Text>
                </Space>
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
                      { value: "rts-cts", label: t("connection.flowRtsCts") },
                    ]}
                  />
                </Form.Item>
              )}
            />
          </Col>
          <Col span={12}>
            <div className="connection-settings-group">
              {t("connection.groupOption")}
            </div>
            <Controller
              name="slaveAddress"
              control={control}
              render={({ field }) => (
                <Form.Item label={t("connection.slaveAddress")}>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    max={255}
                    value={field.value}
                    onChange={(v) => field.onChange(v ?? 1)}
                  />
                </Form.Item>
              )}
            />
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
            <Controller
              name="addressAdjust"
              control={control}
              render={({ field }) => (
                <Form.Item
                  label={t("connection.addressAdjust")}
                  tooltip={t("connection.adjustHint")}
                >
                  <Select
                    style={{ width: "100%" }}
                    value={field.value}
                    onChange={(v) => field.onChange(v)}
                    options={[
                      { value: "off", label: t("connection.adjustOff") },
                      { value: "on", label: t("connection.adjustOn") },
                    ]}
                  />
                </Form.Item>
              )}
            />
          </Col>
        </Row>
        {connectionState !== "disconnected" && connectionState !== "failed" ? (
          <Typography.Text type="secondary">
            {t(`state.${connectionState}`)}
          </Typography.Text>
        ) : null}
        {connectError !== null ? (
          <Alert
            type="error"
            showIcon
            message={connectError}
            style={{ marginTop: 8 }}
          />
        ) : null}
      </Form>
    </Modal>
  );
}
