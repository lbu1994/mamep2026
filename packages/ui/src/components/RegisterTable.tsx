import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Flex,
  Input,
  Segmented,
  Select,
  Switch,
  Table,
  Tooltip,
} from "antd";
import type { InputRef } from "antd";
import { HolderOutlined, PlusOutlined } from "@ant-design/icons";
import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import { DndContext } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ColumnType, ColumnsType } from "antd/es/table";
import type { DataType, RegisterRow, RowId, SheetId } from "@mamep2026/domain";
import { dataTypes } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { useAppStore } from "../app-store";
import { clampColumnWidth } from "./column-resize";
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

// ---- 可编辑单元格（antd 可编辑单元格模式，2026-08-15）----
// 非编辑态：值以无边框文本显示（hover 出现边框提示可编辑），点击或 Enter/Space 进入编辑；
// 编辑态：`Input variant="filled"` 自动聚焦，Enter 或失焦提交。
// 草稿保存在组件本地（短暂态），提交后才写 store——不依赖行内长存状态，
// 虚拟滚动下离屏行卸载不丢已提交值；列级 memo 只传本列最小 props，
// 组件内部 editing/草稿状态不影响行级 MemoRow 的引用比较（P2 优化保持不变）。

interface EditableCellValueProps {
  /** 单元格值：非编辑态显示；进入编辑态时作为初始草稿。 */
  value: string;
  /** 编辑态 Input 与非编辑态按钮共用 aria-label（两状态互斥，getByLabel 不会重复匹配）。 */
  ariaLabel: string;
  /** 校验错误：非编辑态错误样式 + Tooltip，编辑态 Input error 状态。 */
  error?: boolean;
  /** 错误提示文案（error 时 Tooltip 内容）。 */
  errorTip?: string;
  /** 提交回调（Enter/失焦）：参数为最终草稿；草稿未变时不调用。 */
  onCommit: (value: string) => void;
}

function EditableCellValue({
  value,
  ariaLabel,
  error = false,
  errorTip,
  onCommit,
}: EditableCellValueProps): React.ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<InputRef>(null);
  // 防重入：Enter 提交后输入框卸载可能再触发 blur，用 ref 跳过重复提交。
  const editingRef = useRef(false);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const startEdit = (): void => {
    // 进入编辑时以当前显示值初始化草稿。
    setDraft(value);
    setEditing(true);
  };

  const commit = (): void => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    // 草稿未变不提交：避免无谓的 store 更新与自动保存。
    if (draft === value) return;
    onCommit(draft);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        size="small"
        variant="filled"
        style={{ width: "100%" }}
        value={draft}
        aria-label={ariaLabel}
        {...(error ? { status: "error" as const } : {})}
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={commit}
        onBlur={commit}
      />
    );
  }

  const wrap = (
    <div
      className={
        "register-table__editable-cell-value-wrap" +
        (error ? " register-table__editable-cell-value-wrap--error" : "")
      }
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={startEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startEdit();
        }
      }}
    >
      {value}
    </div>
  );
  return error && errorTip !== undefined ? (
    <Tooltip title={errorTip}>{wrap}</Tooltip>
  ) : (
    wrap
  );
}

// ---- 列级 memo 单元格（性能优化，P2）----
// 每个单元格组件只接收该列渲染所需的最小数据字段，actions 从 store 取（引用稳定）。
// 轮询/行更新重建行对象时，未变化字段的列经 React.memo 跳过渲染，
// 避免整行控件（Button/Switch/Select/Input/Tooltip 等）随 Data 值更新全部重渲染。

const NoCell = memo(function NoCell({ order }: { order: number }) {
  return <>{order}</>;
});

const TmCell = memo(function TmCell({
  rowId,
  traceEnabled,
}: {
  rowId: RowId;
  traceEnabled: boolean;
}) {
  const updateRow = useAppStore((s) => s.updateRow);
  const openTraceWindow = useAppStore((s) => s.openTraceWindow);
  const closeTraceWindow = useAppStore((s) => s.closeTraceWindow);
  const host = useAppStore((s) => s.host);
  return (
    <Checkbox
      checked={traceEnabled}
      aria-label="TM"
      onChange={(e) => {
        updateRow(rowId, (r) => ({
          ...r,
          traceEnabled: e.target.checked,
          updatedAt: Date.now(),
        }));
        if (e.target.checked) {
          openTraceWindow(rowId);
        } else {
          host?.traceStop(rowId);
          closeTraceWindow(rowId);
        }
      }}
    />
  );
});

const NameCell = memo(function NameCell({
  rowId,
  name,
}: {
  rowId: RowId;
  name: string;
}) {
  const updateRow = useAppStore((s) => s.updateRow);
  return (
    <EditableCellValue
      value={name}
      ariaLabel="Name"
      onCommit={(value) =>
        updateRow(rowId, (r) => ({
          ...r,
          name: value,
          updatedAt: Date.now(),
        }))
      }
    />
  );
});

const RegisterCell = memo(function RegisterCell({
  rowId,
  addressDraft,
  hasError,
}: {
  rowId: RowId;
  addressDraft: string;
  hasError: boolean;
}) {
  const { t } = useTranslation();
  const updateRow = useAppStore((s) => s.updateRow);
  const commitRowAddress = useAppStore((s) => s.commitRowAddress);
  return (
    <EditableCellValue
      value={addressDraft}
      ariaLabel="Register"
      error={hasError}
      errorTip={t("table.addressError")}
      onCommit={(value) => {
        const result = commitRowAddress(rowId, value);
        // 校验失败：草稿写回 store 以保留用户输入（register-table 包与 §23 约定
        // 「校验失败不得清空用户输入」）。旧实现靠编辑时实时写 addressDraft 保留；
        // 现在草稿在本地，提交失败时必须显式回写，否则非编辑态会回退到旧值、丢失非法输入。
        if (!result.ok) {
          updateRow(rowId, (r) => ({
            ...r,
            addressDraft: value,
            updatedAt: Date.now(),
          }));
        }
      }}
    />
  );
});

const WpCell = memo(function WpCell({
  rowId,
  pollingEnabled,
}: {
  rowId: RowId;
  pollingEnabled: boolean;
}) {
  const { t } = useTranslation();
  const updateRow = useAppStore((s) => s.updateRow);
  return (
    <Tooltip title={t("table.wpHint")}>
      <Switch
        size="small"
        aria-label="WP"
        checked={pollingEnabled}
        onChange={(checked) =>
          updateRow(rowId, (r) => ({
            ...r,
            pollingEnabled: checked,
            updatedAt: Date.now(),
          }))
        }
      />
    </Tooltip>
  );
});

const ReadCell = memo(function ReadCell({ rowId }: { rowId: RowId }) {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const updateRow = useAppStore((s) => s.updateRow);
  const connected = useAppStore((s) => s.connectionState) === "connected";
  const handleRead = async (): Promise<void> => {
    if (host === null || host === undefined) return;
    const state = useAppStore.getState();
    const row = state.workspace.sheets
      .flatMap((sh) => sh.rows)
      .find((r) => r.rowId === rowId);
    if (row === undefined) return;
    const result = await host.readRow(row);
    if (result.ok) {
      updateRow(rowId, () => ({
        ...row,
        cellText: formatRawValue(result.value, row.dataType),
        updatedAt: Date.now(),
      }));
    }
    // 读取失败不改变 Data 单元格内容（§17/§25），错误经日志展示。
  };
  return (
    <Button
      size="small"
      disabled={!connected}
      onClick={() => void handleRead()}
    >
      {t("table.read")}
    </Button>
  );
});

const DataCell = memo(function DataCell({
  rowId,
  cellText,
}: {
  rowId: RowId;
  cellText: string;
}) {
  const updateRow = useAppStore((s) => s.updateRow);
  return (
    <EditableCellValue
      value={cellText}
      ariaLabel="Data"
      onCommit={(value) =>
        updateRow(rowId, (r) => ({
          ...r,
          cellText: value,
          updatedAt: Date.now(),
        }))
      }
    />
  );
});

const WriteCell = memo(function WriteCell({ rowId }: { rowId: RowId }) {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const connected = useAppStore((s) => s.connectionState) === "connected";
  const handleWrite = async (): Promise<void> => {
    if (host === null || host === undefined) return;
    const state = useAppStore.getState();
    const row = state.workspace.sheets
      .flatMap((sh) => sh.rows)
      .find((r) => r.rowId === rowId);
    if (row === undefined) return;
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
  return (
    <Button
      size="small"
      disabled={!connected}
      onClick={() => void handleWrite()}
    >
      {t("table.write")}
    </Button>
  );
});

const TypeCell = memo(function TypeCell({
  rowId,
  dataType,
}: {
  rowId: RowId;
  dataType: DataType;
}) {
  const { t } = useTranslation();
  const setRowDataType = useAppStore((s) => s.setRowDataType);
  const options = useMemo(
    () =>
      dataTypes.map((type) => {
        const label = TYPE_LABELS[type];
        return {
          value: type,
          label: label.startsWith("table.") ? t(label) : label,
        };
      }),
    [t],
  );
  return (
    <Select
      size="small"
      style={{ width: "100%" }}
      value={dataType}
      aria-label="Type"
      onChange={(value: DataType) => setRowDataType(rowId, value)}
      options={options}
    />
  );
});

const CommentCell = memo(function CommentCell({
  rowId,
  comment,
}: {
  rowId: RowId;
  comment: string;
}) {
  const updateRow = useAppStore((s) => s.updateRow);
  return (
    <EditableCellValue
      value={comment}
      ariaLabel="Comment"
      onCommit={(value) =>
        updateRow(rowId, (r) => ({
          ...r,
          comment: value,
          updatedAt: Date.now(),
        }))
      }
    />
  );
});

// ---- dnd-kit 拖拽排序列（2026-08-16）----
// 最右列拖拽手柄：仅手柄可拖（setActivatorNodeRef + listeners 经 RowContext 传给手柄按钮），
// 行体空白处不触发拖拽，避免与单元格编辑/多选冲突。排序动作经 app-store.moveRowToIndex
// 落到领域层（packages/register-table 的 moveRowToIndex，arrayMove 语义）。
interface RowContextProps {
  setActivatorNodeRef?: (element: HTMLElement | null) => void | undefined;
  listeners?: SyntheticListenerMap | undefined;
}

const RowContext = createContext<RowContextProps>({});

const DragHandle = memo(function DragHandle({
  ariaLabel,
}: {
  ariaLabel: string;
}) {
  const { setActivatorNodeRef, listeners } = useContext(RowContext);
  return (
    <Button
      type="text"
      size="small"
      icon={<HolderOutlined />}
      style={{ cursor: "move" }}
      ref={setActivatorNodeRef}
      aria-label={ariaLabel}
      {...listeners}
    />
  );
});

// ---- 表头拖拽列宽（2026-08-16）----
// 通过 Table components.header.cell 自定义表头单元格；width/onResize 经 column.onHeaderCell 透传。
// 实现说明：antd 官方示例用 react-resizable + react-draggable，但 react-draggable v4 在 React 19 下
// 依赖 nodeRef 且拖拽首帧 delta 不稳定（实测列宽会在拖拽开始时跳变，慢速/快速拖拽均复现），
// 故改为自研极简 east 手柄：mousedown 记录起点与当前渲染宽度，document 级 mousemove/mouseup 计算增量，
// 纯鼠标数学、无第三方依赖，行为与官方示例一致且稳健。
// 仅「有默认 width 的列」提供手柄：弹性列（Comment）无 width，若强赋固定宽会使
// table-layout:fixed 下全部列被浏览器按容器比例拉伸、列宽失真（已实测验证），故弹性列不拖拽。

// 固定宽度、不可通过表头拖拽调整的列 key（2026-08-17）。
// 仅「可拖拽列」挂 onHeaderCell：固定列不提供拖拽手柄、并忽略会话内 colWidths 覆盖。
const FIXED_WIDTH_COLUMNS = new Set<string>([
  "no",
  "tm",
  "wp",
  "read",
  "write",
  "drag",
]);

interface ResizeCallbackData {
  size: { width: number; height: number };
}

interface ResizeHeaderCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** 列配置宽度（px）。 */
  width?: number;
  /** 拖拽回调：由 onHeaderCell 透传（非 antd 标准 ColumnType 属性，仅自定义 header cell 消费）。 */
  onResize?: (event: MouseEvent, data: ResizeCallbackData) => void;
}

function ResizableTitle(props: ResizeHeaderCellProps): React.ReactNode {
  const { onResize, width, children, className, ...restProps } = props;
  const thRef = useRef<HTMLTableCellElement>(null);

  const handleMouseDown = (event: React.MouseEvent<HTMLSpanElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (onResize === undefined) return;
    const startClientX = event.clientX;
    // 拖拽基准 = 拖拽开始时刻表头单元格的实际渲染宽度（border-box，含边框）。
    const startWidth = thRef.current?.offsetWidth ?? width ?? 0;
    const handleMouseMove = (moveEvent: MouseEvent): void => {
      onResize(moveEvent, {
        size: {
          width: startWidth + (moveEvent.clientX - startClientX),
          height: 0,
        },
      });
    };
    const handleMouseUp = (): void => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  if (onResize === undefined || width === undefined) {
    return (
      <th {...restProps} className={className}>
        {children}
      </th>
    );
  }

  return (
    <th
      ref={thRef}
      {...restProps}
      className={
        (className !== undefined ? className + " " : "") + "react-resizable"
      }
    >
      {children}
      <span
        className="react-resizable-handle"
        onMouseDown={handleMouseDown}
        onClick={(event) => event.stopPropagation()}
      />
    </th>
  );
}

/**
 * 行级 memo 的 <tr> props（性能优化）：`_record`/`_index`/`_selection` 经 onRow 注入，
 * 仅供 React.memo 比较器判断该行数据/位置/选中集合是否变化，不渲染到 DOM。
 * 选中集合参与比较：选中变化时全行重渲染，刷新 rowSelection 复选框的事件闭包（避免陈旧闭包破坏多选）。
 */
interface MemoTableRowProps {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  _record: RegisterRow;
  _index: number;
  _selection: readonly RowId[];
}

interface RegisterTableProps {
  sheetId: SheetId;
}

/** 表格行高（size="small" 实测固定 29px），虚拟滚动需要固定行高。 */
const ROW_HEIGHT = 29;
/** 虚拟滚动启用阈值：行数超过该值启用 antd Table virtual（避免小表无谓开销）。 */
const VIRTUAL_SCROLL_THRESHOLD = 500;

/** antd Table 未在公开类型暴露但 virtual 模式运行时透传的 props（见 InternalTable virtualProps）。 */
interface RegisterTableVirtualProps {
  /** 虚拟滚动固定行高。 */
  listItemHeight?: number;
  /** 表格在 Flex 中占满剩余空间（虚拟滚动需要高度受限）。 */
  style?: React.CSSProperties;
}

export function RegisterTable({
  sheetId,
}: RegisterTableProps): React.ReactNode {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const rows = useAppStore(
    (s) => s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.rows ?? [],
  );
  const addRow = useAppStore((s) => s.addRow);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const setSheetRegisterRadix = useAppStore((s) => s.setSheetRegisterRadix);
  const [readAllRunning, setReadAllRunning] = useState(false);
  const [menuRowId, setMenuRowId] = useState<RowId | null>(null);
  // 拖拽列宽（纯 UI 状态，会话内有效，不持久化）：仅记录用户拖拽过的列，未拖的列用默认宽。
  const [colWidths, setColWidths] = useState<Partial<Record<string, number>>>(
    {},
  );
  const flexRef = useRef<HTMLDivElement | null>(null);
  const [tableBodyHeight, setTableBodyHeight] = useState(0);
  // 虚拟滚动需要确定的可视高度：表格可视区 = Flex 高度 − 工具栏高度；
  // 用 ResizeObserver 监听窗口缩放/面板拖拽引起的尺寸变化。
  useEffect(() => {
    const flexEl = flexRef.current;
    if (flexEl === null) return;
    const measure = (): void => {
      const toolbar = flexEl.querySelector<HTMLElement>(".table-toolbar");
      const toolbarHeight = toolbar?.offsetHeight ?? 0;
      setTableBodyHeight(Math.max(flexEl.clientHeight - toolbarHeight, 0));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(flexEl);
    return () => ro.disconnect();
  }, []);

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

  // 只订阅本表的 Register 地址进制（ADR-014）：行数据变化不触发本选择器，
  // 配合 updateRow 外科手术式更新，非活动表在单行更新时完全不重渲染（性能优化）。
  const registerRadix = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.registerRadix ??
      "dec",
  );

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

  const moveRowToIndex = useAppStore((s) => s.moveRowToIndex);

  /** dnd-kit 拖拽结束：语义同 arrayMove——把活动行移动到 over 行所在索引，经 store 落到领域层。 */
  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    stopDragScroll();
    if (active.id === over?.id) return;
    const overId = over?.id;
    if (overId === undefined) return;
    const activeIndex = rows.findIndex((r) => r.rowId === active.id);
    const overIndex = rows.findIndex((r) => r.rowId === overId);
    if (activeIndex === -1 || overIndex === -1) return;
    const activeRow = rows[activeIndex];
    if (activeRow === undefined) return;
    moveRowToIndex(sheetId, activeRow.rowId, overIndex);
  };

  // dnd-kit 自定义边缘自动滚动：antd 虚拟表的滚动容器 `.ant-table-tbody-virtual-holder`
  // 是 `overflow: hidden`，dnd-kit 的 getScrollableAncestors 正则（/(auto|scroll|overlay)/）
  // 不识别 hidden，因此拖拽到可视区上下边缘不会自动滚动。
  // 这里在 onDragMove 检测指针贴近边缘时，用 rAF 驱动 holder.scrollTop
  // （rc-table 监听原生 scroll 事件更新内层 translateY，已验证程序化 scrollTop 生效）。
  // 非虚拟模式无需处理：`.ant-table-body` 为 overflow:auto，dnd-kit 原生支持。
  const EDGE_SCROLL_ZONE = 36;
  const dragScrollRef = useRef<{ el: HTMLElement | null; raf: number | null }>({
    el: null,
    raf: null,
  });
  const stopDragScroll = useCallback((): void => {
    if (dragScrollRef.current.raf !== null) {
      cancelAnimationFrame(dragScrollRef.current.raf);
      dragScrollRef.current.raf = null;
    }
  }, []);
  const handleDragStart = useCallback((): void => {
    stopDragScroll();
    dragScrollRef.current.el =
      flexRef.current?.querySelector<HTMLElement>(
        ".ant-table-tbody-virtual-holder",
      ) ?? null;
  }, [stopDragScroll]);
  const handleDragMove = useCallback(
    ({ activatorEvent, delta }: DragMoveEvent): void => {
      const holder = dragScrollRef.current.el;
      if (holder === null || holder === undefined) return;
      const rect = holder.getBoundingClientRect();
      const startY =
        activatorEvent instanceof MouseEvent ? activatorEvent.clientY : 0;
      const clientY = startY + delta.y;
      let step = 0;
      if (clientY < rect.top + EDGE_SCROLL_ZONE) {
        step = -Math.max(1, (rect.top + EDGE_SCROLL_ZONE - clientY) / 4);
      } else if (clientY > rect.bottom - EDGE_SCROLL_ZONE) {
        step = Math.max(1, (clientY - (rect.bottom - EDGE_SCROLL_ZONE)) / 4);
      }
      if (step !== 0 && dragScrollRef.current.raf === null) {
        const tick = (): void => {
          holder.scrollTop += step;
          dragScrollRef.current.raf = requestAnimationFrame(tick);
        };
        dragScrollRef.current.raf = requestAnimationFrame(tick);
      } else if (step === 0) {
        stopDragScroll();
      }
    },
    [stopDragScroll],
  );
  const handleDragCancel = useCallback((): void => {
    stopDragScroll();
    dragScrollRef.current.el = null;
  }, [stopDragScroll]);

  const selectedIds = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);

  /** 行级右键（仅最后一列 drag 列触发）：阻止默认菜单；目标行不在选中集合时先单选它，再由 Dropdown 弹出菜单。 */
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

  /** 行级右键冒泡拦截：仅当单元格层未处理（非 drag 列）时 stopPropagation，
   * 阻止事件到达 Dropdown 的 contextMenu trigger——rc-trigger 会无条件 preventDefault，
   * 吞掉浏览器原生右键菜单；drag 列已在单元格层 preventDefault + 打开菜单（defaultPrevented=true），
   * 放行冒泡让 rc-trigger 记录鼠标点坐标（alignPoint 定位弹出层到右键位置）。 */
  const handleRowContextMenuBubble = (event: React.MouseEvent): void => {
    if (!event.defaultPrevented) {
      event.stopPropagation();
    }
  };

  // 行级 memo 下 <tr> 的事件闭包可能因 React.memo 跳渲染而滞后，
  // 通过 ref 始终指向最新处理器，避免陈旧闭包（与 keydownRef 同模式）。
  const rowHandlersRef = useRef<{
    onRowContextMenu: (rowId: RowId, event: React.MouseEvent) => void;
    onRowContextMenuBubble: (event: React.MouseEvent) => void;
  }>({
    onRowContextMenu: () => {},
    onRowContextMenuBubble: () => {},
  });
  useEffect(() => {
    rowHandlersRef.current = {
      onRowContextMenu: handleRowContextMenu,
      onRowContextMenuBubble: handleRowContextMenuBubble,
    };
  });

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
    // 仅忽略文本类编辑控件（单元格输入/备注/下拉/可编辑单元格非编辑态按钮），避免与编辑冲突；
    // 复选框/开关/按钮等选择控件不拦截快捷键（选中后可直接 Delete/Ctrl+C 等）。
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          "input[type='text'], input:not([type]), textarea, select, .ant-select, .register-table__editable-cell-value-wrap",
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

  /** 拖拽列宽回调：钳制到该列 minWidth 后写入 colWidths（每次拖拽更新 state，实时生效）。 */
  const handleResize = useCallback(
    (key: React.Key) =>
      (_event: MouseEvent, data: ResizeCallbackData): void => {
        const columnKey = String(key);
        setColWidths((prev) => ({
          ...prev,
          [columnKey]: clampColumnWidth(columnKey, data.size.width),
        }));
      },
    [],
  );

  const baseColumns = useMemo<ColumnType<RegisterRow>[]>(
    () => [
      {
        title: t("table.no"),
        key: "no",
        width: 40,
        align: "center",
        render: (_, row) => <NoCell order={row.order} />,
      },
      {
        title: t("table.tm"),
        key: "tm",
        width: 40,
        align: "center",
        render: (_, row) => (
          <TmCell rowId={row.rowId} traceEnabled={row.traceEnabled} />
        ),
      },
      {
        title: t("table.name"),
        key: "name",
        width: 140,
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) => <NameCell rowId={row.rowId} name={row.name} />,
      },
      {
        title:
          registerRadix === "hex"
            ? t("table.registerHex")
            : t("table.registerDec"),
        key: "address",
        // 默认宽 130：112px 时等宽字体下表头 "Register[DEC]"（13 字符 ≈101px + padding 12px）
        // 会换行（"]" 挤到第二行）；130px 单行完整显示，且与 Name(140)/Type(132) 视觉协调。
        // 拖拽仍可自由调整（minWidth 80），此值仅默认宽度；列窄于标题时由 ellipsis 单行省略。
        width: 130,
        align: "center",
        className: "register-table__cell--center",
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) => (
          <RegisterCell
            rowId={row.rowId}
            addressDraft={row.addressDraft}
            hasError={
              row.addressDraft.trim() !== "" && row.addressValue === null
            }
          />
        ),
      },
      {
        title: t("table.wp"),
        key: "wp",
        width: 40,
        align: "center",
        render: (_, row) => (
          <WpCell rowId={row.rowId} pollingEnabled={row.pollingEnabled} />
        ),
      },
      {
        title: t("table.read"),
        key: "read",
        width: 60,
        align: "center",
        render: (_, row) => <ReadCell rowId={row.rowId} />,
      },
      {
        title: t("table.data"),
        key: "data",
        width: 110,
        align: "center",
        className: "register-table__cell--center",
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) => (
          <DataCell rowId={row.rowId} cellText={row.cellText} />
        ),
      },
      {
        title: t("table.write"),
        key: "write",
        width: 60,
        align: "center",
        render: (_, row) => <WriteCell rowId={row.rowId} />,
      },
      {
        title: t("table.type"),
        key: "type",
        width: 132,
        align: "center",
        className: "register-table__cell--center",
        render: (_, row) => (
          <TypeCell rowId={row.rowId} dataType={row.dataType} />
        ),
      },
      {
        title: t("table.comment"),
        key: "comment",
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) => (
          <CommentCell rowId={row.rowId} comment={row.comment} />
        ),
      },
      {
        title: "",
        key: "drag",
        width: 48,
        align: "center",
        // 仅最后一列（drag 列）响应右键打开行级菜单：preventDefault 抑制系统菜单并记录目标行；
        // 不 stopPropagation，放行冒泡到 Dropdown trigger 以记录鼠标点坐标（alignPoint 定位）。
        onCell: (record) => ({
          onContextMenu: (event) =>
            rowHandlersRef.current.onRowContextMenu(record.rowId, event),
        }),
        render: () => <DragHandle ariaLabel={t("table.dragHandle")} />,
      },
    ],
    [t, registerRadix],
  );

  // 合并拖拽列宽并挂载 onHeaderCell（供 ResizableTitle 接收 width/onResize）。
  // 仅「有默认 width 且非固定宽度」的列挂 onHeaderCell：弹性列（Comment）无宽、不拖拽，
  // 避免表格全部列有宽被拉伸；固定列（No/TM/WP/READ/WRITE/拖拽手柄列）不挂，宽度不可调。
  // 依赖仅 baseColumns + colWidths：拖拽只更新列定义，行级 MemoRow 比较器不含 columns，行不重渲染。
  const columns = useMemo<ColumnsType<RegisterRow>>(
    () =>
      baseColumns.map((col) => {
        const fixed =
          col.key !== undefined && FIXED_WIDTH_COLUMNS.has(String(col.key));
        // 固定列忽略会话内 colWidths 覆盖（防御：残留 state 不得改变固定列宽）。
        const width = fixed
          ? col.width
          : (colWidths[String(col.key)] ?? col.width);
        return {
          ...col,
          ...(width !== undefined ? { width } : {}),
          ...(col.width !== undefined && !fixed
            ? {
                onHeaderCell: (column): ResizeHeaderCellProps => {
                  const cellWidth =
                    "width" in column && typeof column.width === "number"
                      ? column.width
                      : undefined;
                  const onResize =
                    column.key !== undefined
                      ? handleResize(column.key)
                      : undefined;
                  return {
                    ...(cellWidth !== undefined ? { width: cellWidth } : {}),
                    ...(onResize !== undefined ? { onResize } : {}),
                  };
                },
              }
            : {}),
        };
      }),
    [baseColumns, colWidths, handleResize],
  );

  // 行级 memo（性能优化）：rc-table 的 BodyRow 通过 immutable mark 随表根重渲染，
  // 这里对 <tr> 做引用级 memo——单行数据变化时仅该行重渲染，其余行跳过整个子树 reconcile。
  // 比较器只比较数据型 props（_record/_index/className），忽略函数型 props 与 style：
  // （onRow 事件闭包每次新建，经 rowHandlersRef 始终指向最新处理器；style 每次新建对象引用，
  // 本表不设行样式，选中/悬停类经 className 按字符串值比较传递）。
  // 依赖与 columns useMemo 一致：任一外部渲染依赖变化时重建行组件，强制全行重渲染，避免陈旧内容。
  const MemoRow = useMemo(() => {
    const MemoizedTr = memo(
      forwardRef<HTMLTableRowElement, MemoTableRowProps>(
        function RegisterTableRow(props, ref) {
          const { _record, _index, _selection, ...rest } = props;
          // 内部 props 仅供 React.memo 比较器使用，不参与 <tr> 渲染。
          void _record;
          void _index;
          void _selection;
          // dnd-kit 可排序行：id 用 rowId（稳定，行数据更新不重建 droppable）。
          // useSortable 内部状态（transform/isDragging）变化会自渲染，不受外层 memo 影响。
          const {
            attributes,
            listeners,
            setNodeRef,
            setActivatorNodeRef,
            transform,
            transition,
            isDragging,
          } = useSortable({ id: _record.rowId });
          // 组合 dnd-kit 的 setNodeRef 与 rc-table 转发的 ref（虚拟滚动测量依赖转发 ref）。
          const setRefs = useCallback(
            (node: HTMLTableRowElement | null) => {
              setNodeRef(node);
              if (ref !== null && ref !== undefined) {
                if (typeof ref === "function") {
                  ref(node);
                } else {
                  ref.current = node;
                }
              }
            },
            [ref, setNodeRef],
          );
          const contextValue = useMemo<RowContextProps>(
            () => ({ setActivatorNodeRef, listeners }),
            [setActivatorNodeRef, listeners],
          );
          // 拖拽中行浮起；transform/transition 来自 dnd-kit，虚拟滚动下行渲染不受影响。
          const style: React.CSSProperties = {
            ...rest.style,
            transform: CSS.Translate.toString(transform),
            transition,
            ...(isDragging ? { position: "relative", zIndex: 9999 } : {}),
          };
          return (
            <RowContext.Provider value={contextValue}>
              <tr
                {...rest}
                {...attributes}
                ref={setRefs}
                style={style}
                role="row"
                tabIndex={-1}
              />
            </RowContext.Provider>
          );
        },
      ),
      (prev, next) =>
        prev._record === next._record &&
        prev._index === next._index &&
        // 选中集合变化时全行重渲染（刷新 rowSelection 复选框闭包，保证多选正确）。
        prev._selection === next._selection &&
        // 注意：不能比较 style —— rc-table 每次渲染都会新建 style 对象引用；
        // 本表不设置行样式，且选中/悬停类通过 className（字符串按值比较）传递。
        prev.className === next.className,
    );
    MemoizedTr.displayName = "RegisterTableRow";
    return MemoizedTr;
  }, []);

  return (
    <Flex vertical style={{ height: "100%" }} ref={flexRef}>
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
      <DndContext
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <Dropdown
          trigger={["contextMenu"]}
          open={menuRowId !== null}
          onOpenChange={(open) => {
            if (!open) setMenuRowId(null);
          }}
          menu={{ items: rowMenuItems }}
        >
          <div className="register-table__context">
            <SortableContext
              items={rows.map((r) => r.rowId)}
              strategy={verticalListSortingStrategy}
            >
              <Table<RegisterRow>
                size="small"
                rowKey="rowId"
                columns={columns}
                dataSource={rows}
                pagination={false}
                bordered
                virtual={rows.length > VIRTUAL_SCROLL_THRESHOLD}
                {...(tableBodyHeight > 0
                  ? ({
                      style: { flex: 1, minHeight: 0 },
                      listItemHeight: ROW_HEIGHT,
                    } as RegisterTableVirtualProps)
                  : {})}
                scroll={
                  tableBodyHeight > 0
                    ? { x: 900, y: tableBodyHeight }
                    : { x: 900 }
                }
                rowSelection={{
                  // 固定复选框列宽（antd 内置能力）：不可拖拽调整。
                  columnWidth: 32,
                  selectedRowKeys: selectedRowIds,
                  onChange: (keys) =>
                    setSelectedRowIds(keys.map((k) => String(k)) as RowId[]),
                  selections: [
                    Table.SELECTION_ALL,
                    Table.SELECTION_INVERT,
                    Table.SELECTION_NONE,
                    {
                      key: "odd",
                      text: t("table.selectOddRows"),
                      onSelect: (changeableRowKeys) =>
                        setSelectedRowIds(
                          changeableRowKeys
                            .filter((_, index) => index % 2 === 0)
                            .map((k) => String(k)) as RowId[],
                        ),
                    },
                    {
                      key: "even",
                      text: t("table.selectEvenRows"),
                      onSelect: (changeableRowKeys) =>
                        setSelectedRowIds(
                          changeableRowKeys
                            .filter((_, index) => index % 2 !== 0)
                            .map((k) => String(k)) as RowId[],
                        ),
                    },
                  ],
                }}
                components={{
                  header: { cell: ResizableTitle },
                  body: { row: MemoRow },
                }}
                onRow={(record, index = 0): MemoTableRowProps => ({
                  // 行级右键冒泡拦截：非 drag 列 stopPropagation 保留系统右键菜单（见 handleRowContextMenuBubble）。
                  onContextMenu: (event) =>
                    rowHandlersRef.current.onRowContextMenuBubble(event),
                  _record: record,
                  _index: index,
                  _selection: selectedRowIds,
                })}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        <>
                          <div>{t("table.emptySheet")}</div>
                          <div
                            style={{
                              color: "var(--ant-color-text-tertiary)",
                              fontSize: 12,
                            }}
                          >
                            {t("table.emptySheetHint")}
                          </div>
                        </>
                      }
                    >
                      <Button
                        size="small"
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => addRow(sheetId)}
                      >
                        {t("table.addRow")}
                      </Button>
                    </Empty>
                  ),
                }}
              />
            </SortableContext>
          </div>
        </Dropdown>
      </DndContext>
    </Flex>
  );
}
