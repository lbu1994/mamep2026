import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  Empty,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tooltip,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { DataType, RegisterRow, SheetId } from "@mamep2026/domain";
import { dataTypes } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { useAppStore } from "../app-store";

const TYPE_LABELS: Record<DataType, string> = {
  hex: "table.hex",
  unsigned: "table.unsigned",
  "unsigned-0.1": "Unsigned 0.1",
  "unsigned-0.01": "Unsigned 0.01",
  "unsigned-0.001": "Unsigned 0.001",
  "unsigned-0.0001": "Unsigned 0.0001",
  signed: "table.signed",
  "signed-0.1": "Signed 0.1",
  "signed-0.01": "Signed 0.01",
  "signed-0.001": "Signed 0.001",
  "signed-0.0001": "Signed 0.0001",
  binary: "table.binary",
};

interface RegisterTableProps {
  sheetId: SheetId;
}

export function RegisterTable({
  sheetId,
}: RegisterTableProps): React.ReactNode {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const rows = useAppStore(
    (s) => s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.rows ?? [],
  );
  const traceWindows = useAppStore((s) => s.traceWindows);
  const connected = useAppStore((s) => s.connectionState) === "connected";
  const updateRow = useAppStore((s) => s.updateRow);
  const commitRowAddress = useAppStore((s) => s.commitRowAddress);
  const addRow = useAppStore((s) => s.addRow);
  const deleteRow = useAppStore((s) => s.deleteRow);
  const moveRowAction = useAppStore((s) => s.moveRow);
  const duplicateRowInSheet = useAppStore((s) => s.duplicateRowInSheet);
  const setRowDataType = useAppStore((s) => s.setRowDataType);
  const openTraceWindow = useAppStore((s) => s.openTraceWindow);
  const closeTraceWindow = useAppStore((s) => s.closeTraceWindow);
  const appendMessage = useAppStore((s) => s.appendMessage);

  const typeLabel = (type: DataType): string => {
    const label = TYPE_LABELS[type];
    return label.startsWith("table.") ? t(label) : label;
  };

  const handleRead = async (row: RegisterRow): Promise<void> => {
    if (host === null || host === undefined) return;
    const result = await host.readRow(row);
    if (result.ok) {
      const applied = applyResult(row, result.value);
      if (applied !== null) updateRow(row.rowId, () => applied);
    } else {
      // 读取失败不改变 Data 单元格内容（§17/§25），错误经日志展示。
    }
  };

  const handleWrite = async (row: RegisterRow): Promise<void> => {
    if (host === null || host === undefined) return;
    const result = await host.writeRow(row);
    if (result.ok) {
      appendMessage({
        timestamp: Date.now(),
        level: "info",
        messageKey: "messages.writeSucceeded",
        detail: null,
      });
    } else {
      appendMessage({
        timestamp: Date.now(),
        level: "error",
        messageKey: "messages.writeFailed",
        detail: result.error.code,
      });
    }
  };

  const applyResult = (row: RegisterRow, raw: number): RegisterRow | null => {
    // 读取成功：按当前 Type 格式化，强制覆盖单元格内容。
    return {
      ...row,
      cellText: formatRawValue(raw, row.dataType),
      updatedAt: Date.now(),
    };
  };

  const columns = useMemo<ColumnsType<RegisterRow>>(
    () => [
      { title: t("table.no"), dataIndex: "order", width: 48 },
      {
        title: t("table.tm"),
        key: "tm",
        width: 48,
        render: (_, row) => (
          <Checkbox
            checked={row.traceEnabled}
            aria-label="TM"
            onChange={(e) => {
              updateRow(row.rowId, (r) => ({
                ...r,
                traceEnabled: e.target.checked,
                updatedAt: Date.now(),
              }));
              if (e.target.checked) {
                openTraceWindow(row.rowId);
              } else {
                host?.traceStop(row.rowId);
                closeTraceWindow(row.rowId);
              }
            }}
          />
        ),
      },
      {
        title: t("table.name"),
        key: "name",
        width: 180,
        render: (_, row) => (
          <Input
            style={{ width: "100%" }}
            value={row.name}
            aria-label="Name"
            onChange={(e) =>
              updateRow(row.rowId, (r) => ({
                ...r,
                name: e.target.value,
                updatedAt: Date.now(),
              }))
            }
          />
        ),
      },
      {
        title: t("table.register"),
        key: "address",
        width: 130,
        render: (_, row) => (
          <Tooltip
            title={
              row.addressDraft.trim() !== "" && row.addressValue === null
                ? t("table.addressError")
                : undefined
            }
          >
            <Input
              style={{ width: "100%" }}
              value={row.addressDraft}
              aria-label="Register"
              {...(row.addressDraft.trim() !== "" && row.addressValue === null
                ? { status: "error" as const }
                : {})}
              onChange={(e) =>
                updateRow(row.rowId, (r) => ({
                  ...r,
                  addressDraft: e.target.value,
                  updatedAt: Date.now(),
                }))
              }
              onBlur={(e) => {
                commitRowAddress(row.rowId, e.target.value);
              }}
              onPressEnter={(e) => {
                commitRowAddress(row.rowId, e.currentTarget.value);
              }}
            />
          </Tooltip>
        ),
      },
      {
        title: t("table.wp"),
        key: "wp",
        width: 48,
        render: (_, row) => (
          <Switch
            size="small"
            aria-label="WP"
            checked={row.pollingEnabled}
            onChange={(checked) =>
              updateRow(row.rowId, (r) => ({
                ...r,
                pollingEnabled: checked,
                updatedAt: Date.now(),
              }))
            }
          />
        ),
      },
      {
        title: t("table.read"),
        key: "read",
        width: 90,
        render: (_, row) => (
          <Button
            size="small"
            disabled={!connected}
            onClick={() => void handleRead(row)}
          >
            {t("table.read")}
          </Button>
        ),
      },
      {
        title: t("table.data"),
        key: "data",
        width: 140,
        render: (_, row) => (
          <Input
            style={{ width: "100%" }}
            value={row.cellText}
            aria-label="Data"
            onChange={(e) =>
              updateRow(row.rowId, (r) => ({
                ...r,
                cellText: e.target.value,
                updatedAt: Date.now(),
              }))
            }
          />
        ),
      },
      {
        title: t("table.write"),
        key: "write",
        width: 90,
        render: (_, row) => (
          <Button
            size="small"
            disabled={!connected}
            onClick={() => void handleWrite(row)}
          >
            {t("table.write")}
          </Button>
        ),
      },
      {
        title: t("table.type"),
        key: "type",
        width: 160,
        render: (_, row) => (
          <Select
            size="small"
            style={{ width: "100%" }}
            value={row.dataType}
            aria-label="Type"
            onChange={(value: DataType) => setRowDataType(row.rowId, value)}
            options={dataTypes.map((type) => ({
              value: type,
              label: typeLabel(type),
            }))}
          />
        ),
      },
      {
        title: t("table.comment"),
        key: "comment",
        width: 200,
        render: (_, row) => (
          <Input
            style={{ width: "100%" }}
            value={row.comment}
            aria-label="Comment"
            onChange={(e) =>
              updateRow(row.rowId, (r) => ({
                ...r,
                comment: e.target.value,
                updatedAt: Date.now(),
              }))
            }
          />
        ),
      },
      {
        title: "",
        key: "actions",
        width: 150,
        render: (_, row) => (
          <Space size={2}>
            <Tooltip title={t("table.moveUp")}>
              <Button
                size="small"
                icon={<ArrowUpOutlined />}
                aria-label={t("table.moveUp")}
                onClick={() => moveRowAction(sheetId, row.rowId, "up")}
              />
            </Tooltip>
            <Tooltip title={t("table.moveDown")}>
              <Button
                size="small"
                icon={<ArrowDownOutlined />}
                aria-label={t("table.moveDown")}
                onClick={() => moveRowAction(sheetId, row.rowId, "down")}
              />
            </Tooltip>
            <Tooltip title={t("table.duplicateRow")}>
              <Button
                size="small"
                icon={<CopyOutlined />}
                aria-label={t("table.duplicateRow")}
                onClick={() => duplicateRowInSheet(sheetId, row.rowId)}
              />
            </Tooltip>
            <Tooltip title={t("table.deleteRow")}>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={t("table.deleteRow")}
                onClick={() => deleteRow(sheetId, row.rowId)}
              />
            </Tooltip>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connected, traceWindows, t, host],
  );

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => addRow(sheetId)}
        >
          {t("table.addRow")}
        </Button>
      </Space>
      <Table<RegisterRow>
        size="small"
        rowKey="rowId"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1200 }}
        locale={{
          emptyText: (
            <Empty
              description={t("table.emptySheet")}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
      />
    </div>
  );
}
