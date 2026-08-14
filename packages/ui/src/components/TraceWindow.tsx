import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Select, Slider, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { RegisterRow, RowId } from "@mamep2026/domain";
import { useAppStore, type BufferSizeOption } from "../app-store";

const TRACE_SPEED_MIN = 100;
const TRACE_SPEED_MAX = 2000;

function speedToInterval(speed: number): number {
  // speed 高 = Quick（间隔小）。
  return Math.round(
    TRACE_SPEED_MAX - (speed / 100) * (TRACE_SPEED_MAX - TRACE_SPEED_MIN),
  );
}

interface TraceWindowProps {
  rowId: RowId;
}

export function TraceWindow({ rowId }: TraceWindowProps): React.ReactNode {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const row = useAppStore((s) =>
    s.workspace.sheets.flatMap((sh) => sh.rows).find((r) => r.rowId === rowId),
  );
  const windowModel = useAppStore((s) => s.traceWindows[rowId]);
  const closeTraceWindow = useAppStore((s) => s.closeTraceWindow);
  const setTracePlaying = useAppStore((s) => s.setTracePlaying);
  const setTraceBufferSize = useAppStore((s) => s.setTraceBufferSize);
  const setTraceSpeed = useAppStore((s) => s.setTraceSpeed);
  const setTraceAverage = useAppStore((s) => s.setTraceAverage);
  const updateRow = useAppStore((s) => s.updateRow);

  useEffect(() => {
    if (
      windowModel?.playing &&
      row?.addressValue !== null &&
      row?.addressValue !== undefined &&
      host !== null
    ) {
      const address = row.addressValue.value;
      host.traceStart(rowId, address, speedToInterval(windowModel.speed));
    } else {
      host?.traceStop(rowId);
    }
    return () => host?.traceStop(rowId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowModel?.playing, windowModel?.speed, row?.addressValue?.value]);

  if (windowModel === undefined || row === undefined) return null;

  const bufferOptions: Array<{ value: BufferSizeOption; label: string }> = [
    { value: "continue", label: t("trace.bufferContinue") },
    ...(["100", "500", "1000", "1500", "2000", "3000"] as const).map((v) => ({
      value: v,
      label: v,
    })),
  ];

  const stopAndAverage = (): void => {
    setTracePlaying(rowId, false);
    const samples = windowModel.samples;
    if (samples.length === 0) {
      setTraceAverage(rowId, null);
      return;
    }
    // 平均值基于原始值的展示文本无法直接求和：以 No./Data 为展示，平均按数值解析。
    const values = samples
      .map((s) => Number.parseFloat(s.value))
      .filter((v) => Number.isFinite(v));
    if (values.length === 0) {
      setTraceAverage(rowId, null);
      return;
    }
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    setTraceAverage(rowId, String(Math.round(average * 10000) / 10000));
  };

  const saveTrace = (): void => {
    const payload = {
      title: t("trace.title"),
      name: row.name,
      address: row.addressDraft,
      type: row.dataType,
      samples: windowModel.samples,
      average: windowModel.average,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trace-${row.rowId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const columns: ColumnsType<{ no: number; value: string }> = [
    { title: t("trace.no"), dataIndex: "no", width: 70 },
    { title: t("trace.data"), dataIndex: "value" },
  ];

  return (
    <div
      className="trace-window"
      style={{
        position: "fixed",
        right: 24,
        top: 80,
        width: 360,
        background: "var(--trace-bg, #fff)",
        border: "1px solid #d9d9d9",
        borderRadius: 8,
        padding: 12,
        zIndex: 1000,
        boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
      }}
    >
      <Space style={{ justifyContent: "space-between", width: "100%" }}>
        <Typography.Text strong>{t("trace.title")}</Typography.Text>
        <Button
          size="small"
          type="text"
          onClick={() => closeTraceWindow(rowId)}
        >
          ✕
        </Button>
      </Space>
      <Space orientation="vertical" style={{ width: "100%" }} size={6}>
        <Space>
          <Typography.Text type="secondary">{t("trace.name")}</Typography.Text>
          <Input
            size="small"
            style={{ width: 140 }}
            value={row.name}
            onChange={(e) =>
              updateRow(row.rowId, (current: RegisterRow) => ({
                ...current,
                name: e.target.value,
                updatedAt: Date.now(),
              }))
            }
          />
          <Typography.Text type="secondary">
            {t("trace.address")}
          </Typography.Text>
          <Input
            size="small"
            style={{ width: 80 }}
            value={row.addressDraft}
            readOnly
          />
        </Space>
        <Space>
          <Typography.Text type="secondary">{t("trace.type")}</Typography.Text>
          <Input
            size="small"
            style={{ width: 120 }}
            value={row.dataType}
            readOnly
          />
        </Space>
        <Space>
          <Button
            size="small"
            type={windowModel.playing ? "default" : "primary"}
            onClick={() => setTracePlaying(rowId, true)}
          >
            ▶ {t("trace.play")}
          </Button>
          <Button size="small" onClick={stopAndAverage}>
            ⏹ {t("trace.stop")}
          </Button>
          <Button size="small" onClick={saveTrace}>
            💾 {t("trace.save")}
          </Button>
        </Space>
        <Space>
          <Typography.Text type="secondary">
            {t("trace.bufferSize")}
          </Typography.Text>
          <Select
            size="small"
            style={{ width: 110 }}
            value={windowModel.bufferSize}
            onChange={(v: BufferSizeOption) => setTraceBufferSize(rowId, v)}
            options={bufferOptions}
          />
        </Space>
        <Space style={{ width: "100%" }}>
          <Typography.Text type="secondary">{t("trace.speed")}</Typography.Text>
          <Typography.Text type="secondary">{t("trace.quick")}</Typography.Text>
          <Slider
            style={{ flex: 1, margin: "0 4px" }}
            min={0}
            max={100}
            value={windowModel.speed}
            onChange={(v) => setTraceSpeed(rowId, v)}
          />
          <Typography.Text type="secondary">{t("trace.slow")}</Typography.Text>
        </Space>
        <Table
          size="small"
          rowKey="no"
          columns={columns}
          dataSource={windowModel.samples}
          pagination={false}
          scroll={{ y: 200 }}
        />
        <Space>
          <Typography.Text type="secondary">
            {t("trace.average")}
          </Typography.Text>
          <Input
            size="small"
            style={{ width: 100 }}
            aria-label="Average"
            value={windowModel.average ?? ""}
            readOnly
          />
        </Space>
      </Space>
    </div>
  );
}
