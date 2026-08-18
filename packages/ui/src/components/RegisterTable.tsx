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
import {
  HolderOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ColumnType, ColumnsType } from "antd/es/table";
import type { DataType, RegisterRow, RowId, SheetId } from "@mamep2026/domain";
import { dataTypes } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { applyColumnOrder } from "@mamep2026/register-table";
import { useAppStore } from "../app-store";
import type { RowFailure } from "../row-result";
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
  /** 值为空且非编辑态时的占位文本（辅助色，不进入编辑草稿）。 */
  emptyText?: string;
  /** 非编辑态值右侧的附加节点（如 Data 列状态点）；编辑态不显示。 */
  trailing?: React.ReactNode;
  /** 提交回调（Enter/失焦）：参数为最终草稿；草稿未变时不调用。 */
  onCommit: (value: string) => void;
}

function EditableCellValue({
  value,
  ariaLabel,
  error = false,
  errorTip,
  emptyText,
  trailing,
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
      <span className="register-table__editable-cell-value-wrap__text">
        {value === "" && emptyText !== undefined ? (
          <span className="register-table__editable-cell-value-placeholder">
            {emptyText}
          </span>
        ) : (
          value
        )}
      </span>
      {trailing}
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
  error,
}: {
  rowId: RowId;
  addressDraft: string;
  /** 地址校验错误（store 记录）：有值时红框 + Tooltip 显示具体原因。 */
  error?: RowFailure | undefined;
}) {
  const { t, i18n } = useTranslation();
  const commitRowAddress = useAppStore((s) => s.commitRowAddress);
  const errorTip =
    error !== undefined
      ? i18n.exists(error.messageKey)
        ? t(error.messageKey)
        : error.messageKey
      : undefined;
  return (
    <EditableCellValue
      value={addressDraft}
      ariaLabel="Register"
      error={error !== undefined}
      {...(errorTip !== undefined ? { errorTip } : {})}
      onCommit={(value) => {
        // 校验、输入保留（§23）、校验错误记录/清除统一由 store 的 commitRowAddress 处理。
        commitRowAddress(rowId, value);
      }}
    />
  );
});

const WpCell = memo(function WpCell({
  rowId,
  pollingEnabled,
  hasAddress,
}: {
  rowId: RowId;
  pollingEnabled: boolean;
  hasAddress: boolean;
}) {
  const { t } = useTranslation();
  const updateRow = useAppStore((s) => s.updateRow);
  const connected = useAppStore((s) => s.connectionState) === "connected";
  // 无合法地址时禁用并说明原因（任务要求）；离线不禁用（可预配置，连接后即生效）。
  const disabled = !hasAddress;
  // 纯 UI 派生轮询指示：已连接 + 有合法地址 + WP 开启 = 正在轮询。
  const polling = connected && hasAddress && pollingEnabled;
  return (
    <Tooltip
      title={disabled ? t("table.emptyAddressTooltip") : t("table.wpHint")}
    >
      <span className="register-table__wp">
        <Switch
          size="small"
          aria-label="WP"
          checked={pollingEnabled}
          disabled={disabled}
          onChange={(checked) =>
            updateRow(rowId, (r) => ({
              ...r,
              pollingEnabled: checked,
              updatedAt: Date.now(),
            }))
          }
        />
        {polling ? (
          <Tooltip title={t("table.pollingActive")}>
            <span
              className="register-table__wp-indicator"
              role="img"
              aria-label={t("table.pollingActive")}
            />
          </Tooltip>
        ) : null}
      </span>
    </Tooltip>
  );
});

const ReadCell = memo(function ReadCell({
  rowId,
  hasAddress,
}: {
  rowId: RowId;
  hasAddress: boolean;
}) {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const updateRow = useAppStore((s) => s.updateRow);
  const recordManualResult = useAppStore((s) => s.recordManualResult);
  const connected = useAppStore((s) => s.connectionState) === "connected";
  // 离线或未配置合法地址时禁用；无地址时提供 Tooltip 说明原因。
  const disabled = !connected || !hasAddress;
  const handleRead = async (): Promise<void> => {
    if (host === null || host === undefined) return;
    const state = useAppStore.getState();
    const row = state.workspace.sheets
      .flatMap((sh) => sh.rows)
      .find((r) => r.rowId === rowId);
    if (row === undefined) return;
    const result = await host.readRow(row);
    // 手动读结果 → 三态状态点（成功清失败态写成功点；失败写失败态并带错误码）。
    recordManualResult(rowId, result, "read");
    if (result.ok) {
      updateRow(rowId, () => ({
        ...row,
        cellText: formatRawValue(result.value, row.dataType),
        updatedAt: Date.now(),
      }));
    }
    // 读取失败不改变 Data 单元格内容（§17/§25），失败原因经状态点 Tooltip 展示。
  };
  const button = (
    <Button
      size="small"
      type="primary"
      disabled={disabled}
      onClick={() => void handleRead()}
    >
      {t("table.read")}
    </Button>
  );
  // 无合法地址时禁用并说明原因（禁用元素不触发 Tooltip，需包一层 span）。
  return !hasAddress ? (
    <Tooltip title={t("table.emptyAddressTooltip")}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  );
});

const DataCell = memo(function DataCell({
  rowId,
  cellText,
  error,
}: {
  rowId: RowId;
  cellText: string;
  /** Data 校验错误（store 记录）：有值时红框 + Tooltip 显示具体原因。 */
  error?: RowFailure | undefined;
}) {
  const { t, i18n } = useTranslation();
  const commitCellText = useAppStore((s) => s.commitCellText);
  // 三态状态点选择器：返回原语/undefined，memo 只在该行状态变化时重渲染
  // （轮询值更新只改 cellText，rowResults/rowDirty/rowSuccess 引用不变则跳过）。
  const failure = useAppStore((s) => s.rowResults[rowId]);
  const dirty = useAppStore((s) => s.rowDirty[rowId] ?? false);
  const success = useAppStore((s) => s.rowSuccess[rowId]);
  // 显示优先级：失败态 > 编辑完成态 > 成功态（§row-result）。
  const dot =
    failure !== undefined ? (
      <RowStatusDot status="error" failure={failure} />
    ) : dirty ? (
      <RowStatusDot status="dirty" />
    ) : success !== undefined ? (
      <RowStatusDot status="success" kind={success.kind} />
    ) : null;
  const errorTip =
    error !== undefined
      ? i18n.exists(error.messageKey)
        ? t(error.messageKey)
        : error.messageKey
      : undefined;
  return (
    <EditableCellValue
      value={cellText}
      ariaLabel="Data"
      // 空值占位「—」：区分「尚未读取/无值」与「有值」，纯 UI 派生，不进入草稿。
      emptyText="—"
      error={error !== undefined}
      {...(errorTip !== undefined ? { errorTip } : {})}
      trailing={dot}
      onCommit={(value) => {
        // 校验、输入保留（§23）、编辑完成态/校验错误统一由 store 的 commitCellText 处理。
        commitCellText(rowId, value);
      }}
    />
  );
});

/**
 * 寄存器行操作结果状态点（Data 列，三态）。
 * 纯颜色区分（§25.5 配 Tooltip 文字与 aria-label）；编辑态不显示（由 EditableCellValue 控制）。
 */
function RowStatusDot({
  status,
  kind,
  failure,
}: {
  status: "success" | "dirty" | "error";
  kind?: "read" | "write";
  failure?: { messageKey: string; detail: string | null };
}): React.ReactNode {
  const { t, i18n } = useTranslation();
  let tip: string;
  if (status === "error") {
    // 失败态：承载原因（§20 简短原因），messageKey 不存在时回退显示原文。
    const key = failure?.messageKey ?? "";
    tip = i18n.exists(key) ? t(key) : key;
  } else if (status === "dirty") {
    tip = t("rowStatus.dirty");
  } else {
    tip =
      kind === "write"
        ? t("rowStatus.writeSuccess")
        : t("rowStatus.readSuccess");
  }
  return (
    <Tooltip title={tip}>
      <span
        className={`register-table__status-dot register-table__status-dot--${status}`}
        role="img"
        aria-label={tip}
      />
    </Tooltip>
  );
}

const WriteCell = memo(function WriteCell({
  rowId,
  hasAddress,
}: {
  rowId: RowId;
  hasAddress: boolean;
}) {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const recordManualResult = useAppStore((s) => s.recordManualResult);
  const connected = useAppStore((s) => s.connectionState) === "connected";
  // 离线或未配置合法地址时禁用；无地址时提供 Tooltip 说明原因。
  const disabled = !connected || !hasAddress;
  const handleWrite = async (): Promise<void> => {
    if (host === null || host === undefined) return;
    const state = useAppStore.getState();
    const row = state.workspace.sheets
      .flatMap((sh) => sh.rows)
      .find((r) => r.rowId === rowId);
    if (row === undefined) return;
    const result = await host.writeRow(row);
    // 手动写结果 → 三态状态点（writeOutcome 支持 §18.2 verify 结果映射）。
    recordManualResult(
      rowId,
      result,
      "write",
      result.ok ? { writeOutcome: result.value } : undefined,
    );
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
  const button = (
    <Button
      size="small"
      type="primary"
      disabled={disabled}
      onClick={() => void handleWrite()}
    >
      {t("table.write")}
    </Button>
  );
  // 无合法地址时禁用并说明原因（禁用元素不触发 Tooltip，需包一层 span）。
  return !hasAddress ? (
    <Tooltip title={t("table.emptyAddressTooltip")}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
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
      placement="bottomLeft"
      variant="borderless"
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
  /** 拖拽结束回调（mouseup）：一次性提交最终列宽（持久化），避免拖拽帧级写 store。 */
  onResizeEnd?: () => void;
  /** 列唯一 key（列拖拽 useSortable id）。antd rowSelection 列没有该字段 → 判定为不可拖拽列。 */
  id?: string;
}

/**
 * 表头单元格（列宽手柄 + 列拖拽排序，2026-08-18）。
 * - 列宽：经 onHeaderCell 透传 width/onResize/onResizeEnd，仅「有默认宽且非固定宽」的可调列渲染 east 手柄。
 * - 列拖拽：useSortable 绑到整个 th（attributes/listeners），水平方向排序；
 *   rowSelection 列（id 为 undefined）用 disabled 对象形式只禁拖动、仍可作其他列排序的放置边界。
 * - 交互边界：east 手柄 mousedown 已 stopPropagation/preventDefault → 拖手柄只调宽、不排序；
 *   拖 th 其余区域 → 排序、不调宽。两者互不干扰。
 * - 拖拽跟随/让位：水平 transform + transition（与行拖拽 MemoRow 同款）；拖完 transform 归零恢复。
 */
function HeaderCell(props: ResizeHeaderCellProps): React.ReactNode {
  const {
    onResize,
    onResizeEnd,
    width,
    id,
    children,
    className,
    style,
    ...restProps
  } = props;
  const thRef = useRef<HTMLTableCellElement>(null);
  const dragDisabled = id === undefined;
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    transform,
    transition,
  } = useSortable({
    id: id ?? "__mamep_selection_column__",
    // 只禁拖动（selection 列不可被拖走，仍可作为其他列排序的放置边界）；其余列默认可拖。
    ...(dragDisabled
      ? { disabled: { draggable: true, droppable: false } }
      : {}),
  });
  // dnd-kit attributes 会覆盖 th 语义（role="button" + tabIndex=0 可聚焦），这会破坏
  // 表格语义（如 getByRole("button", {name:"Read"}) 会把表头误匹配成按钮）并干扰 Tab 焦点序列，
  // 故只应用 aria-* 描述属性，跳过 role/tabIndex（与行级 MemoRow 用显式 role="row" 覆盖同理）。
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    ...sortableAttributes
  } = attributes;
  void _dragRole;
  void _dragTabIndex;
  // 合并 dnd-kit 的 setNodeRef 与列宽基准 thRef（拖拽中的 th 同时被 dnd-kit 与列宽回调使用）。
  const setRefs = useCallback(
    (node: HTMLTableCellElement | null) => {
      setNodeRef(node);
      thRef.current = node;
    },
    [setNodeRef],
  );

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
      // 拖拽结束提交最终列宽（持久化一次；本地 state 已在最后一次 mousemove 镜像到 ref）。
      onResizeEnd?.();
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const resizable = onResize !== undefined && width !== undefined;
  // 拖拽中的列跟随/让位（水平 transform）；selection 列不参与拖拽、不显示移动光标。
  const thStyle: React.CSSProperties = {
    ...style,
    ...(dragDisabled ? {} : { cursor: "move" }),
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging
      ? { position: "relative", zIndex: 9999, userSelect: "none" }
      : {}),
  };
  const thClassName =
    className === undefined
      ? resizable
        ? "react-resizable"
        : undefined
      : className + (resizable ? " react-resizable" : "");

  return (
    <th
      ref={setRefs}
      {...restProps}
      className={thClassName}
      style={thStyle}
      {...(dragDisabled ? {} : sortableAttributes)}
      {...(dragDisabled ? {} : listeners)}
    >
      {children}
      {resizable ? (
        <span
          className="react-resizable-handle"
          onMouseDown={handleMouseDown}
          // 关键：dnd-kit PointerSensor 的激活监听 pointerdown（绑在 th 上），
          // 只阻止 mousedown 会让手柄按下+大幅移动时把「列拖拽」也触发（列被误拖走）。
          // 手柄必须同时阻止 pointerdown 冒泡，列宽拖拽才与列排序完全隔离。
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
      ) : null}
    </th>
  );
}

/**
 * 行级 memo 的 <tr> props（性能优化）：`_record`/`_index`/`_selection`/`_colOrder` 经 onRow 注入，
 * 仅供 React.memo 比较器判断该行数据/位置/选中集合/列顺序是否变化，不渲染到 DOM。
 * 选中集合参与比较：选中变化时全行重渲染，刷新 rowSelection 复选框的事件闭包（避免陈旧闭包破坏多选）。
 * 列顺序签名参与比较：列拖拽排序后数据行必须同步重渲染（否则表头/数据错位，2026-08-18）；
 * 列宽拖拽不改变签名，行仍可跳过渲染（保持列宽拖拽的帧级优化）。
 */
interface MemoTableRowProps {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  _record: RegisterRow;
  _index: number;
  _selection: readonly RowId[];
  /** 当前列 key 顺序签名（列顺序变化时变化，强制数据行重渲染）。 */
  _colOrder: string;
}

interface RegisterTableProps {
  sheetId: SheetId;
}

/** 表格行高（size="small" 实测固定 29px），虚拟滚动需要固定行高。 */
const ROW_HEIGHT = 29;
/** 虚拟滚动启用阈值：行数超过该值启用 antd Table virtual（避免小表无谓开销）。 */
const VIRTUAL_SCROLL_THRESHOLD = 500;
/** 虚拟表在隐藏/未测量时的兜底表体高度（px）：scroll.y 必须为数字，显示后由 ResizeObserver 校正。 */
const FALLBACK_VIRTUAL_HEIGHT = 480;

/** antd Table 未在公开类型暴露但 virtual 模式运行时透传的 props（见 InternalTable virtualProps）。 */
interface RegisterTableVirtualProps {
  /** 虚拟滚动固定行高。 */
  listItemHeight?: number;
  /** 表格在 Flex 中占满剩余空间（虚拟滚动需要高度受限）。 */
  style?: React.CSSProperties;
}

// memo：多标签页下仅当本表自身 props（sheetId）/订阅数据变化才重渲染，
// 避免切换页签时所有已挂载表随父组件（MamepApp）整体重渲染（Tab 切换卡顿根因）。
export const RegisterTable = memo(function RegisterTable({
  sheetId,
}: RegisterTableProps): React.ReactNode {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const cellValidationErrors = useAppStore((s) => s.cellValidationErrors);
  const rows = useAppStore(
    (s) => s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.rows ?? [],
  );
  const addRow = useAppStore((s) => s.addRow);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const setSheetRegisterRadix = useAppStore((s) => s.setSheetRegisterRadix);
  const setSheetColumnWidths = useAppStore((s) => s.setSheetColumnWidths);
  const persistedColWidths = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.columnWidths ??
      {},
  );
  const setSheetColumnOrder = useAppStore((s) => s.setSheetColumnOrder);
  // 本表列排列顺序（每表独立，随 workspace 持久化，IndexedDB 自动保存）；null=默认顺序。
  const columnOrder = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.columnOrder ??
      null,
  );
  const [readAllRunning, setReadAllRunning] = useState(false);
  const [menuRowId, setMenuRowId] = useState<RowId | null>(null);
  // 拖拽列宽（每表独立，随 workspace 持久化，IndexedDB 自动保存）：初始化取本表已保存宽度。
  // 拖拽过程仅改本地 state（拖拽帧级渲染只在本表内），mouseup 时一次性提交 store（触发自动保存）。
  // 不逐帧写 store：避免拖拽帧级 workspace 变更引发订阅者重渲染与调度器/保存副作用。
  const [colWidths, setColWidths] =
    useState<Record<string, number>>(persistedColWidths);
  // 最新列宽镜像：拖拽事件内同步更新（不经渲染），保证 mouseup 提交时拿到完整最终值。
  const colWidthsRef = useRef(colWidths);
  const flexRef = useRef<HTMLDivElement | null>(null);
  const [tableBodyHeight, setTableBodyHeight] = useState(0);
  // 虚拟滚动需要确定的可视高度：表格可视区 = Flex 高度 − 工具栏高度；
  // 用 ResizeObserver 监听窗口缩放/面板拖拽引起的尺寸变化。
  useEffect(() => {
    const flexEl = flexRef.current;
    if (flexEl === null) return;
    const measure = (): void => {
      // 表体可视高度 = 容器底部 − 表头底部。antd Table 的 scroll.y 指「表体滚动区」高度
      // （表头固定在其上方），旧算法只减工具栏、未减表头（≈26px）与表格边框，导致 scroll.y 偏大
      // → 表体超出可视区，行数超一屏时最后一行被 .register-table-wrap 的 overflow:hidden 截断。
      // 这里直接测「表头底 → 容器底」间距，自动计入工具栏高度/表头高度/边框，无需硬编码。
      // 表头在非滚动模式下位于 .ant-table-content 内（.ant-table-thead），滚动模式下位于
      // .ant-table-header 内；两者底部一致，均可用。
      const header = flexEl.querySelector<HTMLElement>(
        ".ant-table-header, .ant-table-thead",
      );
      const toolbar = flexEl.querySelector<HTMLElement>(".table-toolbar");
      const toolbarHeight = toolbar?.offsetHeight ?? 0;
      let next: number;
      if (header !== null && header !== undefined) {
        const flexRect = flexEl.getBoundingClientRect();
        const headerBottom = header.getBoundingClientRect().bottom;
        next = Math.round(flexRect.top + flexEl.clientHeight - headerBottom);
      } else {
        // 表头尚未渲染（防御）：退回旧算法（只减工具栏）。
        next = flexEl.clientHeight - toolbarHeight;
      }
      // 面板隐藏（display:none）时所有尺寸为 0：保持上次有效高度不重置，避免
      // scroll.y 在 0↔实际高 间切换导致 rc-table 重建全部行（含 dnd-kit useSortable，
      // 每次 Tab 切换重建 50 行 ≈ 1s 卡顿根因，2026-08-18 实测）。显示时高度不变 → React 跳过重渲染。
      // 已知限制：挂载即隐藏的表首显会补测一次（每表每会话一次 ~1s，根因是 useSortable 每行成本）。
      if (next <= 0) return;
      setTableBodyHeight(Math.max(next, 0));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(flexEl);
    return () => ro.disconnect();
  }, []);

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
      } else {
        // 批次整体失败（如未连接）：给出明确提示；逐行失败经轮询结果通道标记状态点。
        appendMessage({
          timestamp: Date.now(),
          level: "error",
          messageKey: "messages.readAllFailed",
          params: { detail: result.error.code },
          detail: result.error.code,
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
    // 活动表在事件回调时实时读取（不经响应式订阅）：多标签页下避免全部表因
    // activeSheetId 变化而重渲染（Tab 切换卡顿根因之一）。
    const store = useAppStore.getState();
    if (sheetId !== (store.activeSheetId ?? store.workspace.activeSheetId)) {
      return;
    }
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

  /** 拖拽列宽回调：钳制到该列 minWidth 后写入本地 colWidths（拖拽过程实时生效）。 */
  const handleResize = useCallback(
    (key: React.Key) =>
      (_event: MouseEvent, data: ResizeCallbackData): void => {
        const columnKey = String(key);
        const next = {
          ...colWidthsRef.current,
          [columnKey]: clampColumnWidth(columnKey, data.size.width),
        };
        colWidthsRef.current = next;
        setColWidths(next);
      },
    [],
  );

  /** 拖拽结束（mouseup）一次性提交到 store：workspace 变更 → 自动保存（IndexedDB）。
   *  提交 ref 镜像值，避免 setState 异步时序丢最后一段宽度；本表列宽只由本组件写入。
   *  工厂形式（与 handleResize 同款）：返回的回调在事件中才读 ref，避免 react-hooks/refs
   *  把「读 ref 的函数」当作 render 期直传（经 onHeaderCell 透传会被静态规则误报）。 */
  const makeCommitColWidths = useCallback(
    () => () => {
      setSheetColumnWidths(sheetId, colWidthsRef.current);
    },
    [setSheetColumnWidths, sheetId],
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
        width: 150,
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
        // 默认宽 144：等宽字体下表头 "Register[DEC]" 单行完整显示，且与 Name(150) 视觉协调。
        // 拖拽仍可自由调整（minWidth 80），此值仅默认宽度。
        width: 144,
        align: "center",
        className: "register-table__cell--center register-table__cell--mono",
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) => (
          <RegisterCell
            rowId={row.rowId}
            addressDraft={row.addressDraft}
            {...(cellValidationErrors[`${row.rowId}:address`] !== undefined
              ? { error: cellValidationErrors[`${row.rowId}:address`] }
              : {})}
          />
        ),
      },
      {
        title: t("table.wp"),
        key: "wp",
        width: 56,
        align: "center",
        render: (_, row) => (
          <WpCell
            rowId={row.rowId}
            pollingEnabled={row.pollingEnabled}
            hasAddress={row.addressValue !== null}
          />
        ),
      },
      {
        title: t("table.read"),
        key: "read",
        width: 64,
        align: "center",
        render: (_, row) => (
          <ReadCell rowId={row.rowId} hasAddress={row.addressValue !== null} />
        ),
      },
      {
        title: t("table.data"),
        key: "data",
        width: 124,
        align: "center",
        className: "register-table__cell--center register-table__cell--mono",
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) => (
          <DataCell
            rowId={row.rowId}
            cellText={row.cellText}
            {...(cellValidationErrors[`${row.rowId}:data`] !== undefined
              ? { error: cellValidationErrors[`${row.rowId}:data`] }
              : {})}
          />
        ),
      },
      {
        title: t("table.write"),
        key: "write",
        width: 64,
        align: "center",
        render: (_, row) => (
          <WriteCell rowId={row.rowId} hasAddress={row.addressValue !== null} />
        ),
      },
      {
        title: t("table.type"),
        key: "type",
        // 默认宽 72：为原默认宽（144）的一半（用户需求）。Type 下拉在窄列下省略显示；
        // 拖拽仍可自由调整（COLUMN_MIN_WIDTHS.type 已同步下调为 72，保证默认宽不被钳制）。
        width: 72,
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
    [t, registerRadix, cellValidationErrors],
  );

  // 合并拖拽列宽、按持久化列顺序重排，并挂载 onHeaderCell（供 HeaderCell 接收 id/width/onResize）。
  // - 列顺序：applyColumnOrder 按本表 columnOrder 重排（null=默认顺序）；缺失/新增列容错。
  // - 所有列都挂 onHeaderCell 返回 id（列拖拽 useSortable id）；仅「有默认宽且非固定宽」的可调列
  //   再附加 width/onResize/onResizeEnd（固定列/弹性列只提供 id：可排序、不可调宽）。
  // - 依赖 baseColumns + colWidths + columnOrder：拖拽只更新列定义，行级 MemoRow 比较器不含 columns，行不重渲染。
  const columns = useMemo<ColumnsType<RegisterRow>>(
    () =>
      applyColumnOrder(baseColumns, columnOrder).map((col) => {
        const key = col.key !== undefined ? String(col.key) : undefined;
        const fixed = key !== undefined && FIXED_WIDTH_COLUMNS.has(key);
        // 仅「有默认宽且非固定宽」的可调列接受 colWidths 覆盖：固定列忽略（防御：残留 state
        // 不得改变固定列宽）；弹性列（Comment 无 width）绝不接受覆盖，防止持久化残留数据
        // 破坏弹性列设计（table-layout:fixed 下需保留至少一列无宽弹性列）。
        const width =
          fixed || col.width === undefined || key === undefined
            ? col.width
            : (colWidths[key] ?? col.width);
        const onHeaderCell = (
          column: ColumnType<RegisterRow>,
        ): ResizeHeaderCellProps => {
          const cellWidth =
            "width" in column && typeof column.width === "number"
              ? column.width
              : undefined;
          const resizable = !fixed && cellWidth !== undefined;
          const onResize =
            resizable && column.key !== undefined
              ? handleResize(column.key)
              : undefined;
          return {
            id: String(column.key),
            ...(cellWidth !== undefined ? { width: cellWidth } : {}),
            ...(onResize !== undefined ? { onResize } : {}),
            ...(resizable ? { onResizeEnd: makeCommitColWidths() } : {}),
          };
        };
        return {
          ...col,
          ...(width !== undefined ? { width } : {}),
          onHeaderCell,
        };
      }),
    [baseColumns, colWidths, columnOrder, handleResize, makeCommitColWidths],
  );

  // ---- 列拖拽排序（2026-08-18）----
  // 水平方向排序；第一列（antd rowSelection Checkbox 列）在 HeaderCell 中按「无 id」判定禁拖。
  // 拖拽结束一次性写入本表 columnOrder（workspace 变更 → 自动保存 IndexedDB），与列宽同一持久化通道。
  const columnSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // https://docs.dndkit.com/api-documentation/sensors/pointer#activation-constraints
        distance: 1,
      },
    }),
  );

  /** 列拖拽结束：arrayMove 语义——把活动列移动到 over 列所在索引（只在这 11 个业务列间排序）。 */
  const handleColumnDragEnd = ({ active, over }: DragEndEvent): void => {
    const overId = over?.id;
    if (overId === undefined || active.id === overId) return;
    // 当前顺序：优先已持久化顺序，否则默认（baseColumns 顺序）；selection 列不在其中（永不参与）。
    const currentOrder =
      columnOrder ?? baseColumns.map((col) => String(col.key));
    const activeIndex = currentOrder.findIndex((key) => key === active.id);
    const overIndex = currentOrder.findIndex((key) => key === overId);
    if (activeIndex === -1 || overIndex === -1) return;
    setSheetColumnOrder(
      sheetId,
      arrayMove(currentOrder, activeIndex, overIndex),
    );
  };

  // 当前列 key 顺序签名：仅随「列顺序」变化（列宽拖拽不变），驱动数据行在排序后同步重渲染。
  const columnOrderSignature = columns.map((col) => String(col.key)).join(",");

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
          const { _record, _index, _selection, _colOrder, ...rest } = props;
          void _index;
          void _selection;
          void _colOrder;
          // rc-table 在空数据时也会用自定义行组件渲染空态占位行（record 为 undefined）。
          // 此时无真实数据行，dnd-kit 用占位 id（不参与 SortableContext 排序），
          // 避免 useSortable 的 _record.rowId 崩溃；hooks 保持无条件调用（Hooks 规则）。
          const isEmpty = _record === undefined || _record === null;
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
          } = useSortable({
            id: isEmpty ? "__mamep_empty_row__" : _record.rowId,
          });
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
                {...(isEmpty ? {} : attributes)}
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
        // 列顺序变化时全行重渲染（body 单元格顺序必须跟随表头；列宽拖拽不改变签名）。
        prev._colOrder === next._colOrder &&
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
        <div className="table-toolbar__group">
          {rows.length > 0 ? (
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => addRow(sheetId)}
            >
              {t("table.addRow")}
            </Button>
          ) : null}
          {selectedRowIds.length > 0 ? (
            <span className="table-toolbar__info">
              {t("table.rowsSelected", { count: selectedRowIds.length })}
            </span>
          ) : null}
        </div>
        <span className="table-toolbar__sep" aria-hidden="true" />
        <div className="table-toolbar__group">
          <Button
            size="small"
            type="primary"
            loading={readAllRunning}
            icon={<ReloadOutlined />}
            onClick={() => void handleReadAll()}
          >
            {t("topbar.readAll")}
          </Button>
        </div>
        <span className="table-toolbar__spacer" />
        <div className="table-toolbar__group">
          <Tooltip title={t("table.addressFormatHint")}>
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
              <DndContext
                sensors={columnSensors}
                modifiers={[restrictToHorizontalAxis]}
                onDragEnd={handleColumnDragEnd}
                collisionDetection={closestCenter}
              >
                <SortableContext
                  items={columns.map((col) => String(col.key))}
                  strategy={horizontalListSortingStrategy}
                >
                  <Table<RegisterRow>
                    size="small"
                    rowKey="rowId"
                    columns={columns}
                    dataSource={rows}
                    pagination={false}
                    bordered
                    virtual={rows.length > VIRTUAL_SCROLL_THRESHOLD}
                    {...(tableBodyHeight > 0 ||
                    rows.length > VIRTUAL_SCROLL_THRESHOLD
                      ? ({
                          style: { flex: 1, minHeight: 0 },
                          listItemHeight: ROW_HEIGHT,
                        } as RegisterTableVirtualProps)
                      : {})}
                    scroll={{
                      x: 920,
                      // 虚拟表 scroll.y 必须为数字：隐藏未测量表（tableBodyHeight=0）用兜底高度，
                      // 显示后由 ResizeObserver 校正。否则 rc-table 虚拟渲染失败（0 行 + 报错，2026-08-18 复现）。
                      ...(tableBodyHeight > 0 ||
                      rows.length > VIRTUAL_SCROLL_THRESHOLD
                        ? {
                            y:
                              tableBodyHeight > 0
                                ? tableBodyHeight
                                : FALLBACK_VIRTUAL_HEIGHT,
                          }
                        : {}),
                    }}
                    rowSelection={{
                      // 固定复选框列宽（antd 内置能力）：不可拖拽调整。
                      columnWidth: 32,
                      selectedRowKeys: selectedRowIds,
                      onChange: (keys) =>
                        setSelectedRowIds(
                          keys.map((k) => String(k)) as RowId[],
                        ),
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
                      header: { cell: HeaderCell },
                      body: { row: MemoRow },
                    }}
                    onRow={(record, index = 0): MemoTableRowProps => ({
                      // 行级右键冒泡拦截：非 drag 列 stopPropagation 保留系统右键菜单（见 handleRowContextMenuBubble）。
                      onContextMenu: (event) =>
                        rowHandlersRef.current.onRowContextMenuBubble(event),
                      _record: record,
                      _index: index,
                      _selection: selectedRowIds,
                      _colOrder: columnOrderSignature,
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
              </DndContext>
            </SortableContext>
          </div>
        </Dropdown>
      </DndContext>
    </Flex>
  );
});
