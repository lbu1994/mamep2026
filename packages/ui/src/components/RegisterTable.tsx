import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  Dropdown,
  Input,
  Segmented,
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
import type { DataType, RegisterRow, RowId, SheetId } from "@mamep2026/domain";
import { dataTypes } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { useAppStore } from "../app-store";
import { buildRowMenuItems, type RowMenuActions } from "./RegisterRowMenu";

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
  const sheets = useAppStore((s) => s.workspace.sheets);
  const setSheetRegisterRadix = useAppStore((s) => s.setSheetRegisterRadix);
  const [readAllRunning, setReadAllRunning] = useState(false);
  const [menuRowId, setMenuRowId] = useState<RowId | null>(null);

  const activeSheetId = useAppStore(
    (s) => s.activeSheetId ?? s.workspace.activeSheetId,
  );
  const selectedRowIds = useAppStore((s) => s.selectedRowIds);
  const setSelectedRowIds = useAppStore((s) => s.setSelectedRowIds);
  const insertRowAfter = useAppStore((s) => s.insertRowAfter);
  const insertRowBefore = useAppStore((s) => s.insertRowBefore);
  const moveSelectedRows = useAppStore((s) => s.moveSelectedRows);
  const deleteSelectedRows = useAppStore((s) => s.deleteSelectedRows);
  const copySelectedRows = useAppStore((s) => s.copySelectedRows);
  const cutSelectedRows = useAppStore((s) => s.cutSelectedRows);
  const pasteRows = useAppStore((s) => s.pasteRows);

  const sheet = sheets.find((sh) => sh.sheetId === sheetId);
  const registerRadix = sheet?.registerRadix ?? "dec";

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
        params: { address: row.addressDraft },
        detail: null,
      });
    } else {
      appendMessage({
        timestamp: Date.now(),
        level: "error",
        messageKey: "messages.writeFailed",
        params: { detail: result.error.code },
        detail: result.error.code,
      });
    }
  };

  const handleReadAll = async (): Promise<void> => {
    if (host === null || host === undefined) return;
    setReadAllRunning(true);
    try {
      const handle = host.readAllRows(
        rows.map((row) => ({
          key: row.rowId,
          address: row.addressValue?.value ?? null,
        })),
      );
      const result = await handle.promise;
      if (result.ok) {
        appendMessage({
          timestamp: Date.now(),
          level: "info",
          messageKey: "table.batchSummary",
          params: {
            success: result.value.successCount,
            failure: result.value.failureCount,
            skipped: result.value.skippedCount,
          },
          detail: null,
        });
      }
    } finally {
      setReadAllRunning(false);
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

  const selectedIds = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);

  /** 普通点击行空白处单选该行；多选/范围选择由 antd rowSelection 复选框原生处理。 */
  const handleRowClick = (rowId: RowId, event: React.MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "input, textarea, select, button, a, .ant-select, .ant-switch, .ant-checkbox, .ant-table-selection-column",
      ) !== null
    ) {
      return;
    }
    setSelectedRowIds([rowId]);
  };

  /** 行级右键：阻止默认菜单；目标行不在选中集合时先单选它，再由 Dropdown 弹出菜单。 */
  const handleRowContextMenu = (
    rowId: RowId,
    event: React.MouseEvent,
  ): void => {
    event.preventDefault();
    if (!selectedIds.has(rowId)) {
      setSelectedRowIds([rowId]);
    }
    setMenuRowId(rowId);
  };

  const lastSelectedRowId =
    selectedRowIds.length > 0
      ? (selectedRowIds[selectedRowIds.length - 1] ?? null)
      : null;

  /**
   * 行级键盘：窗口级监听，仅在焦点不在单元格输入控件时触发（避免与单元格编辑/addressDraft 冲突），
   * 且仅作用于当前活动表（多标签页只响应一张表）。
   */
  const handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (sheetId !== activeSheetId) return;
    const target = event.target;
    // 仅忽略文本类编辑控件（单元格输入/备注/下拉），避免与编辑冲突；
    // 复选框/开关/按钮等选择控件不拦截快捷键（选中后可直接 Delete/Ctrl+C 等）。
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          "input[type='text'], input:not([type]), textarea, select, .ant-select",
        ) !== null)
    ) {
      return;
    }
    if (event.key === "Escape") {
      setMenuRowId(null);
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Delete") {
      if (selectedRowIds.length > 0) {
        event.preventDefault();
        deleteSelectedRows(sheetId);
      }
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveSelectedRows(sheetId, "up");
      return;
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveSelectedRows(sheetId, "down");
      return;
    }
    if (mod) {
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        copySelectedRows(sheetId);
        return;
      }
      if (key === "x") {
        event.preventDefault();
        cutSelectedRows(sheetId);
        return;
      }
      if (key === "v") {
        event.preventDefault();
        void pasteRows(sheetId, lastSelectedRowId);
        return;
      }
      if (key === "i") {
        event.preventDefault();
        if (lastSelectedRowId !== null) {
          insertRowAfter(sheetId, lastSelectedRowId);
        } else {
          addRow(sheetId);
        }
        return;
      }
    }
  };

  // 通过 ref 读取最新 handler：每次渲染后在 effect 中更新，窗口监听只绑定一次。
  const keydownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keydownRef.current = handleGlobalKeyDown;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      keydownRef.current(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const rowMenuActions: RowMenuActions = {
    onInsertAbove: (rowId) => insertRowBefore(sheetId, rowId),
    onInsertBelow: (rowId) => insertRowAfter(sheetId, rowId),
    onMoveUp: () => moveSelectedRows(sheetId, "up"),
    onMoveDown: () => moveSelectedRows(sheetId, "down"),
    onCopy: () => copySelectedRows(sheetId),
    onCut: () => cutSelectedRows(sheetId),
    onPaste: () => void pasteRows(sheetId, menuRowId),
    onDelete: () => deleteSelectedRows(sheetId),
  };

  const rowMenuItems =
    menuRowId === null
      ? []
      : buildRowMenuItems(
          t,
          { rowId: menuRowId, selectionCount: selectedRowIds.length },
          rowMenuActions,
        );

  const columns = useMemo<ColumnsType<RegisterRow>>(
    () => [
      { title: t("table.no"), dataIndex: "order", width: 40, align: "center" },
      {
        title: t("table.tm"),
        key: "tm",
        width: 40,
        align: "center",
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
        width: 140,
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
        title:
          registerRadix === "hex"
            ? t("table.registerHex")
            : t("table.registerDec"),
        key: "address",
        width: 112,
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
        width: 40,
        align: "center",
        render: (_, row) => (
          <Tooltip title={t("table.wpHint")}>
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
          </Tooltip>
        ),
      },
      {
        title: t("table.read"),
        key: "read",
        width: 60,
        align: "center",
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
        width: 110,
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
        width: 60,
        align: "center",
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
        width: 132,
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
        width: 96,
        align: "center",
        render: (_, row) => (
          <Space className="row-actions" size={2}>
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
    [connected, traceWindows, t, host, registerRadix],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="table-toolbar">
        {rows.length > 0 ? (
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => addRow(sheetId)}
          >
            {t("table.addRow")}
          </Button>
        ) : null}
        <Button
          size="small"
          loading={readAllRunning}
          onClick={() => void handleReadAll()}
        >
          {t("topbar.readAll")}
        </Button>
        {selectedRowIds.length > 0 ? (
          <span className="table-toolbar__info">
            {t("table.rowsSelected", { count: selectedRowIds.length })}
          </span>
        ) : null}
        <span className="table-toolbar__spacer" />
        <Tooltip title={t("table.registerRadixHint")}>
          <span className="table-toolbar__radix">
            <span className="table-toolbar__radix-label">
              {t("table.registerRadixLabel")}
            </span>
            <Segmented
              size="small"
              aria-label={t("table.addressFormat")}
              options={[
                { label: "DEC", value: "dec" },
                { label: "HEX", value: "hex" },
              ]}
              value={registerRadix}
              onChange={(value) => {
                if (value === "hex" || value === "dec") {
                  setSheetRegisterRadix(sheetId, value);
                }
              }}
            />
          </span>
        </Tooltip>
        <span className="table-toolbar__info">
          {t("table.rowCount", { count: rows.length })}
        </span>
      </div>
      <Dropdown
        trigger={["contextMenu"]}
        open={menuRowId !== null}
        onOpenChange={(open) => {
          if (!open) setMenuRowId(null);
        }}
        menu={{ items: rowMenuItems }}
      >
        <div className="register-table__context">
          <Table<RegisterRow>
            size="small"
            rowKey="rowId"
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 900 }}
            rowSelection={{
              selectedRowKeys: selectedRowIds,
              onChange: (keys) =>
                setSelectedRowIds(keys.map((k) => String(k)) as RowId[]),
            }}
            onRow={(record) => ({
              onClick: (event) => handleRowClick(record.rowId, event),
              onContextMenu: (event) =>
                handleRowContextMenu(record.rowId, event),
            })}
            locale={{
              emptyText: (
                <div className="empty-guide">
                  <div className="empty-guide__title">
                    {t("table.emptySheet")}
                  </div>
                  <div className="empty-guide__hint">
                    {t("table.emptySheetHint")}
                  </div>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => addRow(sheetId)}
                  >
                    {t("table.addRow")}
                  </Button>
                </div>
              ),
            }}
          />
        </div>
      </Dropdown>
    </div>
  );
}
