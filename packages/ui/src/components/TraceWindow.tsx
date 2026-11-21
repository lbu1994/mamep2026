import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "antd/es/button";
import Card from "antd/es/card";
import Flex from "antd/es/flex";
import Input from "antd/es/input";
import Select from "antd/es/select";
import Slider from "antd/es/slider";
import Space from "antd/es/space";
import Table from "antd/es/table";
import Tooltip from "antd/es/tooltip";
import Typography from "antd/es/typography";
import {
  CloseOutlined,
  DownloadOutlined,
  PauseOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { useShallow } from "zustand/react/shallow";
import type { ColumnsType } from "antd/es/table";
import type { RegisterRow, RowId } from "@mamep2026/domain";
import { useAppStore, type BufferSizeOption } from "../app-store";
import { requestRouteForSheet } from "../request-route";
import { computeTraceAverage } from "../trace-statistics";
import { traceSpeedToInterval } from "../trace-speed";
import { isCommunicationAvailable } from "../communication-gate";

const TRACE_WINDOW_WIDTH = 360;
const TRACE_WINDOW_TOP = 80;
const TRACE_WINDOW_RIGHT_MARGIN = 24;
const DRAG_MIN_MOVE_PX = 3;

interface TraceWindowProps {
  rowId: RowId;
}

export function TraceWindow({ rowId }: TraceWindowProps): React.ReactNode {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const communicationAvailable = useAppStore((s) =>
    isCommunicationAvailable(s.connectionState),
  );
  const playReasonId = useId();
  const row = useAppStore((s) =>
    s.workspace.sheets.flatMap((sh) => sh.rows).find((r) => r.rowId === rowId),
  );
  const sheetRoute = useAppStore(
    useShallow((s) => {
      const sheet = s.workspace.sheets.find((candidate) =>
        candidate.rows.some((candidateRow) => candidateRow.rowId === rowId),
      );
      return sheet === undefined
        ? null
        : { type: sheet.type, slaveAddress: sheet.slaveAddress };
    }),
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
      communicationAvailable &&
      row?.addressValue !== null &&
      row?.addressValue !== undefined &&
      host !== null &&
      sheetRoute !== null
    ) {
      const address = row.addressValue.value;
      host.traceStart(
        rowId,
        address,
        traceSpeedToInterval(windowModel.speed),
        row.registerCount,
        requestRouteForSheet(host, sheetRoute),
      );
    } else {
      host?.traceStop(rowId);
    }
    return () => host?.traceStop(rowId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    windowModel?.playing,
    windowModel?.speed,
    communicationAvailable,
    row?.addressValue?.value,
    row?.registerCount,
    sheetRoute?.type,
    sheetRoute?.slaveAddress,
  ]);

  // 窗口位置（拖动标题栏移动）；默认右上角，重新打开后回到默认位置。
  const [position, setPosition] = useState(() => ({
    x: Math.max(
      0,
      window.innerWidth - TRACE_WINDOW_WIDTH - TRACE_WINDOW_RIGHT_MARGIN,
    ),
    y: TRACE_WINDOW_TOP,
  }));
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // 拖动期间禁用文本选择，避免选中窗口内文本。
  useEffect(() => {
    if (!dragging) return;
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  const onTitlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onTitlePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag = dragState.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) < DRAG_MIN_MOVE_PX && Math.abs(dy) < DRAG_MIN_MOVE_PX) {
      return;
    }
    setPosition({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const endTitleDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

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
    const average = computeTraceAverage(windowModel.samples);
    if (average === null) {
      setTraceAverage(rowId, null, null);
      return;
    }
    setTraceAverage(rowId, String(Math.round(average.value * 10000) / 10000), {
      sampleCount: average.sampleCount,
      firstNo: average.firstNo,
      lastNo: average.lastNo,
    });
  };

  const saveTrace = (): void => {
    const payload = {
      title: t("trace.title"),
      name: row.name,
      address: row.addressDraft,
      type: row.dataType,
      samples: windowModel.samples,
      average: windowModel.average,
      averageStats: windowModel.averageStats,
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
    { title: t("trace.no"), dataIndex: "no", width: 70, align: "center" },
    { title: t("trace.data"), dataIndex: "value", align: "center" },
  ];

  return (
    <Card
      size="small"
      className="trace-window"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: TRACE_WINDOW_WIDTH,
        zIndex: 1000,
      }}
      title={
        <div
          className="trace-window__title"
          style={{ userSelect: "none", cursor: "move" }}
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={endTitleDrag}
          onPointerCancel={endTitleDrag}
        >
          <span
            aria-hidden="true"
            className={
              windowModel.playing
                ? "trace-window__status-dot trace-window__status-dot--live"
                : "trace-window__status-dot"
            }
          />
          <span className="trace-window__title-text">{t("trace.title")}</span>
        </div>
      }
      extra={
        <Tooltip title={t("trace.close")}>
          <Button
            size="small"
            type="text"
            aria-label={t("trace.close")}
            icon={<CloseOutlined />}
            onClick={() => closeTraceWindow(rowId)}
          />
        </Tooltip>
      }
    >
      <Flex vertical gap={12}>
        {/* 寄存器信息 */}
        <div className="trace-window__group trace-window__group--fields">
          <Flex vertical gap={6}>
            <Flex align="center" gap={6}>
              <Typography.Text className="trace-window__label">
                {t("trace.name")}
              </Typography.Text>
              <Input
                size="small"
                style={{ flex: 1, minWidth: 0 }}
                value={row.name}
                onChange={(e) =>
                  updateRow(row.rowId, (current: RegisterRow) => ({
                    ...current,
                    name: e.target.value,
                    updatedAt: Date.now(),
                  }))
                }
              />
            </Flex>
            <Flex align="center" gap={6}>
              <Typography.Text className="trace-window__label">
                {t("trace.address")}
              </Typography.Text>
              <Input
                size="small"
                className="trace-window__mono"
                style={{ flex: 1, minWidth: 0 }}
                value={row.addressDraft}
                readOnly
              />
              <Typography.Text className="trace-window__label">
                {t("trace.type")}
              </Typography.Text>
              <Input
                size="small"
                className="trace-window__mono"
                style={{ flex: 1, minWidth: 0 }}
                value={row.dataType}
                readOnly
              />
            </Flex>
          </Flex>
        </div>

        {/* 采样控制 */}
        <div className="trace-window__group">
          <Flex vertical gap={6}>
            <Flex align="center" gap={8}>
              <Space size={6}>
                <Tooltip
                  title={
                    communicationAvailable
                      ? undefined
                      : t("table.connectBeforeCommunication")
                  }
                >
                  <span>
                    <Button
                      size="small"
                      type={
                        windowModel.playing || !communicationAvailable
                          ? "default"
                          : "primary"
                      }
                      icon={<PlayCircleOutlined />}
                      disabled={!communicationAvailable}
                      aria-describedby={
                        communicationAvailable ? undefined : playReasonId
                      }
                      onClick={() => setTracePlaying(rowId, true)}
                    >
                      {t("trace.play")}
                    </Button>
                  </span>
                </Tooltip>
                {!communicationAvailable ? (
                  <span id={playReasonId} className="register-table__sr-only">
                    {t("table.connectBeforeCommunication")}
                  </span>
                ) : null}
                <Button
                  size="small"
                  className={
                    windowModel.playing
                      ? "trace-window__btn-stop trace-window__btn-stop--active"
                      : "trace-window__btn-stop"
                  }
                  icon={<PauseOutlined />}
                  onClick={stopAndAverage}
                >
                  {t("trace.stop")}
                </Button>
              </Space>
              <span className="trace-window__btn-spacer" />
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={saveTrace}
              >
                {t("trace.save")}
              </Button>
            </Flex>
            <Flex align="center" gap={6}>
              <Typography.Text className="trace-window__label">
                {t("trace.bufferSize")}
              </Typography.Text>
              <Select
                size="small"
                style={{ width: 110 }}
                value={windowModel.bufferSize}
                onChange={(v: BufferSizeOption) => setTraceBufferSize(rowId, v)}
                options={bufferOptions}
              />
            </Flex>
            <Flex align="center" gap={8} style={{ width: "100%" }}>
              <Typography.Text className="trace-window__label">
                {t("trace.speed")}
              </Typography.Text>
              <Typography.Text className="trace-window__label">
                {t("trace.quick")}
              </Typography.Text>
              <Slider
                style={{ flex: 1, minWidth: 0 }}
                min={0}
                max={100}
                value={windowModel.speed}
                onChange={(v) => setTraceSpeed(rowId, v)}
              />
              <Typography.Text className="trace-window__label">
                {t("trace.slow")}
              </Typography.Text>
            </Flex>
          </Flex>
        </div>

        {/* 采样数据列表 */}
        <div className="trace-window__group">
          <Table
            size="small"
            rowKey="no"
            columns={columns}
            dataSource={windowModel.samples}
            pagination={false}
            scroll={{ y: 200 }}
          />
        </div>

        {/* 统计读数 */}
        <div className="trace-window__average-box">
          <Typography.Text className="trace-window__label">
            {t("trace.average")}
          </Typography.Text>
          <Input
            size="small"
            variant="borderless"
            className="trace-window__average"
            aria-label="Average"
            value={windowModel.average ?? ""}
            readOnly
          />
          {windowModel.averageStats !== null && (
            <Typography.Text className="trace-window__average-range">
              {t("trace.averageRange", {
                count: windowModel.averageStats.sampleCount,
                first: windowModel.averageStats.firstNo,
                last: windowModel.averageStats.lastNo,
              })}
            </Typography.Text>
          )}
        </div>
      </Flex>
    </Card>
  );
}
