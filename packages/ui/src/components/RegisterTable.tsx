import {
  createContext,
  forwardRef,
  lazy,
  memo,
  Suspense,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { App as AntApp } from "antd";
import Button from "antd/es/button";
import Checkbox from "antd/es/checkbox";
import Dropdown from "antd/es/dropdown";
import Empty from "antd/es/empty";
import Flex from "antd/es/flex";
import Input from "antd/es/input";
import type { InputRef } from "antd/es/input";
import InputNumber from "antd/es/input-number";
import Popover from "antd/es/popover";
import Segmented from "antd/es/segmented";
import type {
  BaseOptionType,
  DefaultOptionType,
  SelectProps,
} from "antd/es/select";
import Switch from "antd/es/switch";
import Table from "antd/es/table";
import Tooltip from "antd/es/tooltip";
import Typography from "antd/es/typography";
import {
  ColumnWidthOutlined,
  HolderOutlined,
  MoreOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  StopOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
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
import type { BatchReadHandle } from "@mamep2026/communication";
import type {
  DataType,
  ReadVerifySettings,
  RegisterRadix,
  RegisterRow,
  RowId,
  SheetId,
} from "@mamep2026/domain";
import { defaultConfig, sheetTypeWritable } from "@mamep2026/domain";
import { formatRegisterAddress } from "@mamep2026/data-conversion";
import {
  applyColumnOrder,
  isRowTypeCountValid,
} from "@mamep2026/register-table";
import {
  combineRadixScale,
  dataTypeToRadix,
  dataTypeToScale,
  isScaleApplicable,
  RADIX_LABEL_KEYS,
  RADIX_OPTIONS,
  SCALE_OPTIONS,
  type DataRadix,
  type ScaleValue,
} from "../type-split";
import {
  buildTreeRows,
  isVirtualBitRow,
  isVirtualChildRow,
  isVirtualRow,
  type VirtualBitRow,
  type VirtualChildRow,
} from "../tree-rows";
import { useAppStore } from "../app-store";
import { useIsMobileLayout } from "../layout/breakpoints";
import { useAfterFirstPaint } from "../after-first-paint";
import { markUiStartup } from "../startup-marks";
import type { RowFailure } from "../row-result";
import { computeNoColumnWidth } from "../no-column-width";
import { usePluginContributions } from "../plugin/use-contributions";
import type {
  AddressTransformContribution,
  DataTypeContribution,
  ToolbarActionContribution,
} from "../plugin/plugin-registries";
import { clampColumnWidth } from "./column-resize";
import { buildRowMenuItems, type RowMenuActions } from "./RegisterRowMenu";
import { ReadAllResultMessage } from "./ReadAllResultMessage";
import {
  isAnyModalOpen,
  isArrowNavigationBlocked,
  isTextInputTarget,
} from "../keyboard/guards";
import { matchesShortcut, tableShortcut } from "../keyboard/shortcuts";
import { readRowById, writeRowById } from "../row-io";
import { requestRouteForSheet } from "../request-route";
import { runPluginToolbarAction } from "../plugin-toolbar-actions";

/** Select 用于单元格类型编辑与工具栏高级配置，首帧后按需加载，避免进入 modulepreload。 */
// React.lazy 的类型擦除泛型值类型；在加载边界恢复所需的 Select 调用签名。
type DeferredSelectComponent = <
  ValueType = string | number,
  OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType,
>(
  props: SelectProps<ValueType, OptionType>,
) => React.ReactNode;
const Select = lazy(
  () => import("antd/es/select"),
) as unknown as DeferredSelectComponent;
const MobileNativeSelectContext = createContext(false);

interface NativeSelectOption {
  value: string | number;
  label: React.ReactNode;
  disabled: boolean;
}

function nativeSelectOptions(value: unknown): NativeSelectOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): NativeSelectOption[] => {
    if (candidate === null || typeof candidate !== "object") return [];
    const option = candidate as Record<string, unknown>;
    if (Array.isArray(option.options)) {
      return nativeSelectOptions(option.options);
    }
    if (typeof option.value !== "string" && typeof option.value !== "number") {
      return [];
    }
    const label =
      typeof option.label === "string" || typeof option.label === "number"
        ? option.label
        : String(option.value);
    return [
      {
        value: option.value,
        label,
        disabled: option.disabled === true,
      },
    ];
  });
}

function MobileNativeSelect<
  ValueType extends string | number = string | number,
  OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType,
>(props: SelectProps<ValueType, OptionType>): React.ReactNode {
  const options = nativeSelectOptions(props.options);
  return (
    <select
      className="register-table__native-select"
      style={props.style}
      value={props.value === undefined ? "" : String(props.value)}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
      aria-invalid={props.status === "error" ? true : undefined}
      onChange={(event) => {
        const selected = options.find(
          (option) => String(option.value) === event.currentTarget.value,
        );
        props.onChange?.(selected?.value as ValueType);
      }}
    >
      {options.map((option) => (
        <option
          key={String(option.value)}
          value={String(option.value)}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}

function DeferredSelect<
  ValueType extends string | number = string | number,
  OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType,
>(props: SelectProps<ValueType, OptionType>): React.ReactNode {
  const ariaLabel = props["aria-label"];
  const useNativeSelect = useContext(MobileNativeSelectContext);
  if (useNativeSelect) {
    return <MobileNativeSelect {...props} />;
  }
  return (
    <Suspense
      fallback={
        <span
          className="register-table__deferred-control"
          {...(typeof ariaLabel === "string"
            ? { "aria-label": ariaLabel }
            : {})}
        />
      }
    >
      <Select {...props} />
    </Suspense>
  );
}

/** 写后回读配置选项（PRD §6.5.12）：Select value ↔ ReadVerifySettings。 */
type WriteVerifyOptionValue = "off" | "immediate" | "100" | "200" | "500";

const WRITE_VERIFY_OPTIONS: Array<{
  value: WriteVerifyOptionValue;
  settings: ReadVerifySettings;
}> = [
  { value: "off", settings: { mode: "off", delayMs: null } },
  { value: "immediate", settings: { mode: "immediate", delayMs: null } },
  { value: "100", settings: { mode: "delayed", delayMs: 100 } },
  { value: "200", settings: { mode: "delayed", delayMs: 200 } },
  { value: "500", settings: { mode: "delayed", delayMs: 500 } },
];

function writeVerifyToValue(
  settings: ReadVerifySettings,
): WriteVerifyOptionValue {
  if (settings.mode === "off") return "off";
  if (settings.mode === "immediate") return "immediate";
  return String(settings.delayMs) as WriteVerifyOptionValue;
}

function writeVerifyOptionLabel(value: WriteVerifyOptionValue): string {
  if (value === "off") return "table.writeVerifyOff";
  if (value === "immediate") return "table.writeVerifyOn";
  return "table.writeVerifyOnDelay";
}

function writeVerifyOptionMs(value: WriteVerifyOptionValue): number | null {
  return value === "100" || value === "200" || value === "500"
    ? Number(value)
    : null;
}

// ---- 可编辑单元格（antd 可编辑单元格模式）----
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
  /** 只读（位明细行）：禁用进入编辑，仅展示文本。 */
  disabled?: boolean;
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
  disabled = false,
  onCommit,
}: EditableCellValueProps): React.ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [optimisticValue, setOptimisticValue] = useState<{
    value: string;
    baseValue: string;
  } | null>(null);
  const inputRef = useRef<InputRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // 防重入：Enter 提交后输入框卸载可能再触发 blur，用 ref 跳过重复提交。
  const editingRef = useRef(false);
  /** Enter 提交后恢复单元格焦点；失焦提交不反向抢回用户刚点击的目标。 */
  const restoreFocusRef = useRef(false);
  // 同步追踪最新草稿：onChange 的 setState 是异步重渲染，若在渲染完成前提交
  // （如自动化 fill+立即 Enter / 用户快速输入），commit 闭包读到旧 draft 会误判
  // "未修改"而跳过提交（real e2e 发现）。commit 改读 ref 根治。
  const draftRef = useRef(value);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      wrapperRef.current?.focus();
    }
  }, [editing]);

  // Store 一旦给出新值（本地提交已落库，或设备回读覆盖），立即撤销显示镜像。
  useEffect(() => {
    if (optimisticValue === null || value === optimisticValue.baseValue) {
      return;
    }
    const timer = window.setTimeout(() => setOptimisticValue(null), 0);
    return () => window.clearTimeout(timer);
  }, [optimisticValue, value]);

  const startEdit = (): void => {
    // 进入编辑时以当前显示值初始化草稿。
    setOptimisticValue(null);
    setDraft(value);
    draftRef.current = value;
    // 同步置编辑态标记：useEffect 更新是异步的（浏览器在渲染提交后才运行 effect），
    // 若在 effect 运行前立即提交（自动化 click+fill+Enter / 用户快速操作），commit 会
    // 因 editingRef 仍为 false 提前 return 而丢弃输入（real e2e 竞态，
    // 与 draftRef 同类）。同步更新根治。
    editingRef.current = true;
    setEditing(true);
  };

  const commit = (restoreFocus = false): void => {
    if (!editingRef.current) return;
    editingRef.current = false;
    if (restoreFocus) restoreFocusRef.current = true;
    const nextValue = draftRef.current;
    // 先同步结束编辑并显示提交值，让 1000 行表的可见单元格立即反馈；
    // Store/自动保存/轮询目标更新随后在独立任务执行，不阻塞 Enter 的下一帧。
    flushSync(() => {
      if (nextValue !== value) {
        setOptimisticValue({ value: nextValue, baseValue: value });
      }
      setEditing(false);
    });
    // 草稿未变不提交：避免无谓的 store 更新与自动保存。
    if (nextValue === value) return;
    // Store 提交放到下一宏任务：Enter 事件只负责结束编辑并绘制乐观值，避免 1000 行
    // 表格的级联更新挤入 Event Timing；后续用户点击发生在新的任务，可读到已提交值。
    window.setTimeout(() => onCommit(nextValue), 0);
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
        onChange={(e) => {
          setDraft(e.target.value);
          draftRef.current = e.target.value;
        }}
        onPressEnter={() => commit(true)}
        onBlur={() => commit(false)}
      />
    );
  }

  const displayedValue =
    optimisticValue !== null && value === optimisticValue.baseValue
      ? optimisticValue.value
      : value;
  const wrap = (
    <div
      ref={wrapperRef}
      className={
        "register-table__editable-cell-value-wrap" +
        (error ? " register-table__editable-cell-value-wrap--error" : "") +
        (disabled ? " register-table__editable-cell-value-wrap--readonly" : "")
      }
      {...(disabled
        ? {}
        : {
            role: "button",
            tabIndex: 0,
            onClick: startEdit,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                startEdit();
              }
            },
          })}
      aria-label={ariaLabel}
      data-committed-value={value}
    >
      <span className="register-table__editable-cell-value-wrap__text">
        {displayedValue === "" && emptyText !== undefined ? (
          <span className="register-table__editable-cell-value-placeholder">
            {emptyText}
          </span>
        ) : (
          displayedValue
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
  dataType,
  registerCount,
}: {
  rowId: RowId;
  traceEnabled: boolean;
  /** 多寄存器字符串行：Trace 对组合数值采样，字符串行禁用。 */
  dataType: DataType;
  registerCount: number;
}) {
  const updateRow = useAppStore((s) => s.updateRow);
  const openTraceWindow = useAppStore((s) => s.openTraceWindow);
  const closeTraceWindow = useAppStore((s) => s.closeTraceWindow);
  const host = useAppStore((s) => s.host);
  // 窗口打开期间 Checkbox 保持勾选，禁止通过取消勾选关闭窗口（单向同步）。
  const traceWindowOpen = useAppStore(
    (s) => s.traceWindows[rowId] !== undefined,
  );
  const traceDisabled = registerCount > 1 && dataType === "string";
  return (
    <Checkbox
      checked={traceEnabled}
      disabled={traceDisabled}
      aria-label="TM"
      onChange={(e) => {
        if (!e.target.checked && traceWindowOpen) {
          // 窗口打开时取消勾选无效：不更新状态、不关闭窗口，保持勾选。
          return;
        }
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
  // 可撤销（TECH_DESIGN §24.4）：改名经 store.setRowName 入撤销栈。
  const setRowName = useAppStore((s) => s.setRowName);
  return (
    <EditableCellValue
      value={name}
      ariaLabel="Name"
      onCommit={(value) => setRowName(rowId, value)}
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
      ariaLabel="Address"
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
  // 可撤销（§24.4「修改轮询设置」）：经 store.setPollingEnabled 入撤销栈。
  const setPollingEnabled = useAppStore((s) => s.setPollingEnabled);
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
          onChange={(checked) => setPollingEnabled(rowId, checked)}
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
  typeCountValid,
}: {
  rowId: RowId;
  hasAddress: boolean;
  /** 范围长度与类型合法集匹配：不匹配时禁用读写。 */
  typeCountValid: boolean;
}) {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const updateRow = useAppStore((s) => s.updateRow);
  const recordManualResult = useAppStore((s) => s.recordManualResult);
  const connected = useAppStore((s) => s.connectionState) === "connected";
  // 离线、未配置合法地址或范围长度与类型合法集不匹配时禁用；无地址时提供 Tooltip 说明原因。
  const disabled = !connected || !hasAddress || !typeCountValid;
  // 单行读逻辑统一在 row-io.readRowById（与 F8 读选中行快捷键共用）。
  const handleRead = (): void => {
    if (host === null || host === undefined) return;
    void readRowById(host, rowId, { updateRow, recordManualResult });
  };
  const button = (
    <Button
      size="small"
      type="primary"
      disabled={disabled}
      onClick={handleRead}
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
  sheetId,
  rowId,
  hasAddress,
  typeCountValid,
}: {
  sheetId: SheetId;
  rowId: RowId;
  hasAddress: boolean;
  /** 范围长度与类型合法集匹配：不匹配时禁用读写。 */
  typeCountValid: boolean;
}) {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const recordManualResult = useAppStore((s) => s.recordManualResult);
  const updateRow = useAppStore((s) => s.updateRow);
  const connected = useAppStore((s) => s.connectionState) === "connected";
  // 只读表：discrete-input/input-register 按表类型禁用写（WriteCell 守卫）。
  const sheetType = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.type ??
      "holding-register",
  );
  const readOnly = !sheetTypeWritable(sheetType);
  // 离线、未配置合法地址、范围长度与类型合法集不匹配或只读表时禁用；无地址时提供 Tooltip 说明原因。
  const disabled = !connected || !hasAddress || !typeCountValid || readOnly;

  // 单行写逻辑（含每表写后回读配置）统一在 row-io.writeRowById
  // （与 Ctrl+Shift+Enter 写选中行快捷键共用）。
  const handleWrite = (): void => {
    if (host === null || host === undefined) return;
    void writeRowById(host, sheetId, rowId, {
      updateRow,
      recordManualResult,
      appendMessage,
    });
  };
  const button = (
    <Button
      size="small"
      type="primary"
      disabled={disabled}
      onClick={handleWrite}
    >
      {t("table.write")}
    </Button>
  );
  // 无合法地址时禁用并说明原因（禁用元素不触发 Tooltip，需包一层 span）；只读表同理。
  return !hasAddress ? (
    <Tooltip title={t("table.emptyAddressTooltip")}>
      <span>{button}</span>
    </Tooltip>
  ) : readOnly ? (
    <Tooltip title={t("table.readOnlyTable")}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  );
});

const TypeCell = memo(function TypeCell({
  rowId,
  dataType,
  error,
}: {
  rowId: RowId;
  dataType: DataType;
  /** 类型列校验错误：范围长度与类型合法集不匹配时红框 + Tooltip。 */
  error?: RowFailure | undefined;
}) {
  const { t, i18n } = useTranslation();
  const setRowDataType = useAppStore((s) => s.setRowDataType);
  const host = useAppStore((s) => s.host);
  // 插件数据类型：贡献点声明（id/titleKey）+ 已注册运行时（resolver.list）。
  // 注意：订阅 resolver 对象本身（稳定引用），list() 在渲染时调用避免 selector 返回新数组触发无限重渲染。
  const dataTypeResolver = useAppStore((s) => s.dataTypeResolver);
  const dataTypeContributions = usePluginContributions<DataTypeContribution>(
    host,
    "dataType",
  );
  const registeredTypes = dataTypeResolver.list();
  const pluginDataTypeOptions = dataTypeContributions
    .filter((c) => registeredTypes.includes(c.payload.id))
    .map((c) => ({
      value: c.payload.id,
      label: i18n.exists(c.payload.titleKey)
        ? t(c.payload.titleKey)
        : c.payload.id,
    }));
  // Type 双列拆分：进制列 + scale 列，组合映射回 dataType。
  const radix = dataTypeToRadix(dataType);
  const scale = dataTypeToScale(dataType);
  // 插件类型行：Select 显示插件类型 id；内置行显示进制。
  const selectValue = pluginDataTypeOptions.some((o) => o.value === dataType)
    ? (dataType as string)
    : radix;
  const errorTip =
    error !== undefined
      ? i18n.exists(error.messageKey)
        ? t(error.messageKey)
        : error.messageKey
      : undefined;
  return (
    <Tooltip
      title={errorTip}
      placement="topLeft"
      open={error !== undefined ? undefined : false}
    >
      <DeferredSelect
        size="small"
        style={{ width: "100%" }}
        value={selectValue}
        aria-label="Type"
        placement="bottomLeft"
        variant="borderless"
        {...(error !== undefined ? { status: "error" as const } : {})}
        onChange={(value: string) => {
          // 插件类型：value 即 dataType id（单寄存器）；内置走进制+scale 组合。
          const plugin = pluginDataTypeOptions.find((o) => o.value === value);
          if (plugin !== undefined) {
            setRowDataType(rowId, plugin.value as DataType);
            return;
          }
          setRowDataType(rowId, combineRadixScale(value as DataRadix, scale));
        }}
        options={[
          ...RADIX_OPTIONS.map((r) => ({
            value: r,
            label: t(RADIX_LABEL_KEYS[r]),
          })),
          ...pluginDataTypeOptions,
        ]}
      />
    </Tooltip>
  );
});

/** Type scale 列：仅 unsigned/signed 可用，其余进制禁用。 */
const ScaleCell = memo(function ScaleCell({
  rowId,
  dataType,
}: {
  rowId: RowId;
  dataType: DataType;
}) {
  const { t } = useTranslation();
  const setRowDataType = useAppStore((s) => s.setRowDataType);
  const radix = dataTypeToRadix(dataType);
  const scale = dataTypeToScale(dataType);
  const applicable = isScaleApplicable(radix);
  return (
    <Tooltip
      title={t("table.scaleHint")}
      placement="topLeft"
      open={applicable ? undefined : false}
    >
      <DeferredSelect
        size="small"
        style={{ width: "100%" }}
        value={scale}
        aria-label="Scale"
        placement="bottomLeft"
        variant="borderless"
        disabled={!applicable}
        onChange={(value: ScaleValue) =>
          setRowDataType(rowId, combineRadixScale(radix, value))
        }
        options={SCALE_OPTIONS.map((s) => ({ value: s, label: s }))}
      />
    </Tooltip>
  );
});

const CommentCell = memo(function CommentCell({
  rowId,
  comment,
}: {
  rowId: RowId;
  comment: string;
}) {
  // 可撤销（TECH_DESIGN §24.4）：改备注经 store.setRowComment 入撤销栈。
  const setRowComment = useAppStore((s) => s.setRowComment);
  return (
    <EditableCellValue
      value={comment}
      ariaLabel="Comment"
      onCommit={(value) => setRowComment(rowId, value)}
    />
  );
});

// ---- 范围行虚拟子行（+ 子行可编辑化）----
// 子行=每寄存器一行：Address 列只读展示实际地址；Name/Data/Type/Scale/Comment 五列
// 可编辑，经 app-store 的 commitChildCellText / setChildMeta 路由回父行（registers[i] +
// registerValues[i] 落盘）；其余列（No/TM/WP/Read/Write/拖拽/多选/右键菜单）维持不可用。

/** 子行 Address 列：实际地址（按表进制格式化），只读。 */
const ChildAddressCell = memo(function ChildAddressCell({
  row,
  radix,
}: {
  row: VirtualChildRow;
  radix: RegisterRadix;
}) {
  return (
    <span className="register-table__cell--mono">
      {formatRegisterAddress(row.__virtualChild.address, radix)}
    </span>
  );
});

/** 子行 Name 列：可编辑（写回父行 registers[i].name）。 */
const ChildNameCell = memo(function ChildNameCell({
  row,
}: {
  row: VirtualChildRow;
}) {
  const setChildMeta = useAppStore((s) => s.setChildMeta);
  return (
    <EditableCellValue
      value={row.name}
      ariaLabel="Name"
      onCommit={(value) =>
        setChildMeta(row.__virtualChild.parentRowId, row.__virtualChild.index, {
          name: value,
        })
      }
    />
  );
});

/** 子行 Data 列：可编辑（按子行自身 Type 解析，回写父行 registerValues[i] 并同步组合文本）。 */
const ChildDataCell = memo(function ChildDataCell({
  row,
}: {
  row: VirtualChildRow;
}) {
  const commitChildCellText = useAppStore((s) => s.commitChildCellText);
  return (
    <EditableCellValue
      value={row.cellText}
      ariaLabel="Data"
      // 空值占位「—」：区分「尚未读取/无值」与「有值」。
      emptyText="—"
      onCommit={(value) =>
        commitChildCellText(
          row.__virtualChild.parentRowId,
          row.__virtualChild.index,
          value,
        )
      }
    />
  );
});

/** 子行 Type 列：可下拉选择（写回父行 registers[i].dataType，仅影响该子行展示与编辑解析）。 */
const ChildTypeCell = memo(function ChildTypeCell({
  row,
}: {
  row: VirtualChildRow;
}) {
  const { t } = useTranslation();
  const setChildMeta = useAppStore((s) => s.setChildMeta);
  const radix = dataTypeToRadix(row.dataType);
  const scale = dataTypeToScale(row.dataType);
  return (
    <DeferredSelect
      size="small"
      style={{ width: "100%" }}
      value={radix}
      aria-label="Type"
      placement="bottomLeft"
      variant="borderless"
      onChange={(value: DataRadix) =>
        setChildMeta(row.__virtualChild.parentRowId, row.__virtualChild.index, {
          dataType: combineRadixScale(value, scale),
        })
      }
      options={RADIX_OPTIONS.map((r) => ({
        value: r,
        label: t(RADIX_LABEL_KEYS[r]),
      }))}
    />
  );
});

/** 子行 Scale 列：可下拉选择（仅 unsigned/signed 可用），写回父行 registers[i].dataType。 */
const ChildScaleCell = memo(function ChildScaleCell({
  row,
}: {
  row: VirtualChildRow;
}) {
  const { t } = useTranslation();
  const setChildMeta = useAppStore((s) => s.setChildMeta);
  const radix = dataTypeToRadix(row.dataType);
  const scale = dataTypeToScale(row.dataType);
  const applicable = isScaleApplicable(radix);
  return (
    <Tooltip
      title={t("table.scaleHint")}
      placement="topLeft"
      open={applicable ? undefined : false}
    >
      <DeferredSelect
        size="small"
        style={{ width: "100%" }}
        value={scale}
        aria-label="Scale"
        placement="bottomLeft"
        variant="borderless"
        disabled={!applicable}
        onChange={(value: ScaleValue) =>
          setChildMeta(
            row.__virtualChild.parentRowId,
            row.__virtualChild.index,
            {
              dataType: combineRadixScale(radix, value),
            },
          )
        }
        options={SCALE_OPTIONS.map((s) => ({ value: s, label: s }))}
      />
    </Tooltip>
  );
});

/** 子行 Comment 列：可编辑（写回父行 registers[i].comment）。 */
const ChildCommentCell = memo(function ChildCommentCell({
  row,
}: {
  row: VirtualChildRow;
}) {
  const setChildMeta = useAppStore((s) => s.setChildMeta);
  return (
    <EditableCellValue
      value={row.comment}
      ariaLabel="Comment"
      onCommit={(value) =>
        setChildMeta(row.__virtualChild.parentRowId, row.__virtualChild.index, {
          comment: value,
        })
      }
    />
  );
});

// ---- 位明细虚拟行----
// 位行 = 一个 16 位寄存器展开出的 16 行之一（bit15 → bit0）：Name 列位名称（可编辑，同 Comment 列），
// Address 列显示「寄存器地址 + Bit 序号」（掩码作为 hover 提示），Data 列**只有开关 1/0**
// （未读取时开关内显示 `—` 代替 `0`；只改当前值、**不写设备**），Comment 列可编辑位注释（入撤销栈）。
// 其余列（No/TM/WP/Read/Write/Type/Scale/拖拽/多选/右键菜单）维持不可用；
// 只读表（discrete-input/input-register）可展开查看但开关与 Name/注释编辑禁用。

/** 位行 Name 列：位名称（可编辑，语义同 Comment 列；只读表禁用）。 */
const BitNameCell = memo(function BitNameCell({
  row,
  writable,
}: {
  row: VirtualBitRow;
  /** 本表可写（只读表禁用编辑）。 */
  writable: boolean;
}) {
  const setBitName = useAppStore((s) => s.setBitName);
  return (
    <EditableCellValue
      value={row.name}
      ariaLabel="Name"
      disabled={!writable}
      onCommit={(value) =>
        setBitName(
          row.__virtualBit.parentRowId,
          row.__virtualBit.registerIndex,
          row.__virtualBit.bit,
          value,
        )
      }
    />
  );
});

/**
 * 位行 Address 列：寄存器地址 + Bit 序号（如 `2000 Bit 15`，只读）；
 * 位掩码（如 `0x8000`）作为 hover 提示保留。
 */
const BitRegisterCell = memo(function BitRegisterCell({
  row,
  radix,
}: {
  row: VirtualBitRow;
  radix: RegisterRadix;
}) {
  const { t } = useTranslation();
  return (
    <span
      className="register-table__cell--mono"
      title={row.__virtualBit.maskText}
    >
      {`${formatRegisterAddress(row.__virtualBit.address, radix)} ${t(
        "table.bitLabel",
        { bit: row.__virtualBit.bit },
      )}`}
    </span>
  );
});

/**
 * 位行 Data 列：仅一个开关（`1`/`0`），不再提供输入框（交互简化）。
 * 未读取（值为 null）时开关**内部**显示「—」代替 `0`（与「读到 0」区分）；开关仍可切换
 * （按「cellText 派生、失败即全 0」基准）。
 * 只改当前值、**不写设备**、不入撤销栈；只读表的开关禁用。
 */
const BitDataCell = memo(function BitDataCell({
  row,
  writable,
}: {
  row: VirtualBitRow;
  /** 本表可写（只读表禁用切换）。 */
  writable: boolean;
}) {
  const { t } = useTranslation();
  const setRegisterBitValue = useAppStore((s) => s.setRegisterBitValue);
  const value = row.__virtualBit.value;
  return (
    <div className="register-table__bit-value">
      <Switch
        className="register-table__bit-toggle"
        checkedChildren="1"
        // 未读取：未选中侧显示「—」而非 `0`（读到 0 时仍为 `0`）。
        unCheckedChildren={value === null ? "—" : "0"}
        disabled={!writable}
        checked={value === 1}
        aria-label={t("table.bitToggle", { bit: row.__virtualBit.bit })}
        onChange={(checked) => {
          if (!writable) return;
          setRegisterBitValue(
            // 必须用**真实**父行 rowId（范围行的寄存器子行 id 是派生的虚拟 id，store 中不存在）。
            row.__virtualBit.parentRowId,
            row.__virtualBit.registerIndex,
            row.__virtualBit.bit,
            checked ? 1 : 0,
          );
        }}
      />
    </div>
  );
});

/** 位行 Comment 列：可编辑位注释（入撤销栈；只读表禁用）。 */
const BitCommentCell = memo(function BitCommentCell({
  row,
  writable,
}: {
  row: VirtualBitRow;
  /** 本表可写（只读表禁用编辑）。 */
  writable: boolean;
}) {
  const setBitComment = useAppStore((s) => s.setBitComment);
  return (
    <EditableCellValue
      value={row.comment}
      ariaLabel="Comment"
      disabled={!writable}
      onCommit={(value) =>
        setBitComment(
          row.__virtualBit.parentRowId,
          row.__virtualBit.registerIndex,
          row.__virtualBit.bit,
          value,
        )
      }
    />
  );
});

// ---- dnd-kit 拖拽排序列----
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

// ---- 表头拖拽列宽----
// 通过 Table components.header.cell 自定义表头单元格；width/onResize 经 column.onHeaderCell 透传。
// east 手柄使用 mousedown 记录起点与当前渲染宽度，document 级 mousemove/mouseup 计算增量，
// 不依赖第三方拖拽组件。
// 仅「有默认 width 的列」提供手柄：弹性列（Comment）无 width，若强赋固定宽会使
// table-layout:fixed 下全部列被浏览器按容器比例拉伸、列宽失真（已实测验证），故弹性列不拖拽。

// 固定宽度、不可通过表头拖拽调整的列 key。
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
 * 表头单元格（列宽手柄 + 列拖拽排序）。
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
 * 列顺序签名参与比较：列拖拽排序后数据行必须同步重渲染（否则表头/数据错位）；
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
  /** 生产启动时先提交工具栏，下一帧挂载表体；组件单测默认即时挂载。 */
  deferBody?: boolean;
}

/** 表格行高（size="small" 实测固定 29px），虚拟滚动需要固定行高。 */
const ROW_HEIGHT = 29;
/** 移动布局行高（触摸目标 ≥44dp）：与 apps/web/src/mobile.css 的 td height 同源。 */
const MOBILE_ROW_HEIGHT = 44;
/** 移动布局横向滚动下限（列总宽之和小于该值时仍可横向滑动，避免列被挤压换行）。 */
const MOBILE_SCROLL_X = 960;
/**
 * 虚拟滚动启用阈值：默认工作区为 50 行，若沿用 500 行阈值会在启动时一次性提交
 * 全部可编辑单元格，形成数百毫秒 Long Task。20 行以上统一虚拟渲染；小表仍走普通表格。
 */
const VIRTUAL_SCROLL_THRESHOLD = 20;
/** 直接使用组件（含单测）保持原 500 行阈值；生产启动由 MamepApp 显式启用 20 行阈值。 */
const DIRECT_RENDER_VIRTUAL_THRESHOLD = 500;
/**
 * 虚拟表首次提交时的保守表体高度（px）：scroll.y 必须为数字。先只挂载约 8 行，
 * 首帧后 ResizeObserver 再校正到真实高度，避免启动时一次创建整屏可编辑单元格。
 */
const FALLBACK_VIRTUAL_HEIGHT = 240;

/** antd Table 未在公开类型暴露但 virtual 模式运行时透传的 props（见 InternalTable virtualProps）。 */
interface RegisterTableVirtualProps {
  /** 虚拟滚动固定行高。 */
  listItemHeight?: number;
  /** 表格在 Flex 中占满剩余空间（虚拟滚动需要高度受限）。 */
  style?: React.CSSProperties;
}

// memo：多标签页下仅当本表自身 props（sheetId）/订阅数据变化才重渲染，
// 避免切换页签时所有已挂载表随父组件（MamepApp）整体重渲染（Tab 切换卡顿根因）。
const RegisterTableContent = memo(function RegisterTableContent({
  sheetId,
  deferBody = false,
}: RegisterTableProps): React.ReactNode {
  const { t } = useTranslation();
  // antd 全局 message（App.useApp）：Read All 完成结果富内容提示；
  // modal：ROM/RAM 确定指令安全确认（EEPROM 寿命提示）。
  // 应用已在 MamepApp 用 <AntApp> 包裹（测试须包 <AntApp>，见 BottomPanel.test.tsx）。
  const { message, modal } = AntApp.useApp();
  const host = useAppStore((s) => s.host);
  // 插件工具栏动作贡献：payload 为数组（一插件可贡献多个动作），
  // 按目标表类型过滤（核心表匹配 holding-register；插件表匹配 <pluginId>:<tableTypeId>）。
  //  为安川 ROM/RAM 确定指令提供内置执行，其余动作保持占位（插件 runtime）。
  const sheetType = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.type ??
      "holding-register",
  );
  // 本表可写（位明细）：只读表（discrete-input/input-register）位切换与位注释编辑禁用。
  const sheetWritable = sheetTypeWritable(sheetType);
  const toolbarActions = usePluginContributions<ToolbarActionContribution[]>(
    host,
    "toolbarAction",
  )
    .flatMap((contribution) =>
      contribution.payload.map((payload) => ({
        pluginId: contribution.pluginId,
        payload,
      })),
    )
    .filter((action) => {
      const target = action.payload.targetTableType;
      if (target === undefined) return true;
      if (sheetType === "holding-register")
        return target === "holding-register";
      return sheetType === `${action.pluginId}:${target}`;
    });
  // 连接状态订阅：连接/断开时刷新（工具栏「从站地址 / Unit ID」label 按活动协议切换，
  // TCP Unit ID 会话内动态修改；协议只在连接时变化）。
  const connectionState = useAppStore((s) => s.connectionState);
  const cellValidationErrors = useAppStore((s) => s.cellValidationErrors);
  const rows = useAppStore(
    (s) => s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.rows ?? [],
  );
  // 工具栏先提交，表格主体在下一帧挂载：两部分的 React commit 分开，
  // 但 store 中始终使用完整工作区，不产生“部分行被编辑/保存”的中间事实。
  const stagedTableReady = useAfterFirstPaint(true);
  const tableReady = !deferBody || stagedTableReady;
  useEffect(() => {
    if (tableReady) markUiStartup("table-ready");
  }, [tableReady]);
  // 范围行树形数据：registerCount>1 的行带 children（虚拟子行，只读展示）。
  const treeRows = useMemo(() => buildTreeRows(rows), [rows]);
  // 本表最大行号（No 列宽度自适应）：No 列内容 = antd 树形展开图标 +
  // 行号，虚拟表列宽须静态确定，故按最大行号位数计算列宽（见 no-column-width.ts）。
  // 虚拟子行在 No 列渲染 null，不计入；rows 为父行集合。
  const maxOrder = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.order), 0),
    [rows],
  );
  /**
   * 大表统一启用 antd 虚拟渲染。
   * antd v6 Virtual BodyGrid 会先按 expandedKeys 扁平化 tree children，
   * 因此范围行/位明细不必再整体关闭 virtual；派生行仍排除拖拽/多选。
   */
  const virtualScrollThreshold = deferBody
    ? VIRTUAL_SCROLL_THRESHOLD
    : DIRECT_RENDER_VIRTUAL_THRESHOLD;
  const virtualScrollingEnabled = rows.length > virtualScrollThreshold;
  const addRow = useAppStore((s) => s.addRow);
  const appendMessage = useAppStore((s) => s.appendMessage);
  // 插件工具栏动作执行（插件外部化）：requiresConfirm 先弹
  // 安全确认（文案经贡献点 confirmKey，安川 ROM/RAM 确定指令 EEPROM 寿命提示，决策③），
  // 确认后经 PluginRegistry 委托插件同进程 runtime（handleToolbarAction → 通信面写
  // 0900H/0910H，不回读、不触发轮询刷新，语义由插件承担）；无 handler 的动作按钮置灰。
  const handlePluginToolbarAction = useCallback(
    (action: { pluginId: string; payload: ToolbarActionContribution }) => {
      const actionId = action.payload.id;
      const run = () => {
        if (host === null || host === undefined) return;
        void runPluginToolbarAction(host, action.pluginId, actionId, {
          appendMessage,
        });
      };
      if (action.payload.requiresConfirm) {
        modal.confirm({
          title: t(action.payload.titleKey),
          content: t(action.payload.confirmKey ?? action.payload.titleKey),
          okText: t("table.confirm"),
          cancelText: t("connection.cancel"),
          onOk: run,
        });
      } else {
        run();
      }
    },
    [appendMessage, host, modal, t],
  );
  const setSheetRegisterRadix = useAppStore((s) => s.setSheetRegisterRadix);
  const setSheetColumnWidths = useAppStore((s) => s.setSheetColumnWidths);
  const setSheetColumnOrder = useAppStore((s) => s.setSheetColumnOrder);
  const persistedColWidths = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.columnWidths ??
      {},
  );
  // 本表列排列顺序（每表独立，随 workspace 持久化，IndexedDB 自动保存）；null=默认顺序。
  const columnOrder = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.columnOrder ??
      null,
  );
  const [readAllRunning, setReadAllRunning] = useState(false);
  // 全表读取运行态句柄与递增序号：取消/重新读取的竞态守卫——
  // 只有最新一次读取的 promise 落定才允许改运行态，过期 promise 不再清状态。
  const readAllHandleRef = useRef<BatchReadHandle | null>(null);
  const readAllSeqRef = useRef(0);
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
      // 每次 Tab 切换重建 50 行 ≈ 1s 卡顿根因实测）。显示时高度不变 → React 跳过重渲染。
      // 已知限制：挂载即隐藏的表首显会补测一次（每表每会话一次 ~1s，根因是 useSortable 每行成本）。
      if (next <= 0) return;
      startTransition(() => setTableBodyHeight(Math.max(next, 0)));
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
  // 键盘读写选中行/轮询启停（PRD §8.3 P1）依赖的单行读/写/轮询动作。
  const updateRow = useAppStore((s) => s.updateRow);
  const recordManualResult = useAppStore((s) => s.recordManualResult);
  const setPollingEnabled = useAppStore((s) => s.setPollingEnabled);
  // 撤销/重做（TECH_DESIGN §24.4）：canUndo/canRedo 由历史栈长度派生（按钮禁用态）。
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const canUndo = useAppStore((s) => s.undoStack.length > 0);
  const canRedo = useAppStore((s) => s.redoStack.length > 0);

  // 只订阅本表的 Register 地址进制：行数据变化不触发本选择器，
  // 配合 updateRow 外科手术式更新，非活动表在单行更新时完全不重渲染（性能优化）。
  const registerRadix = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.registerRadix ??
      "dec",
  );
  // 本表的 Slave Address（每表独立，随表持久化）：受控组件直接读 store、
  // onChange 提交 store（无本地 state 同步问题，区别于列宽拖拽的本地态）。
  const slaveAddress = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.slaveAddress ??
      defaultConfig.registerTable.slaveAddress,
  );
  const setSheetSlaveAddress = useAppStore((s) => s.setSheetSlaveAddress);
  // 本表写后回读配置（每表独立）：默认关闭。
  const writeVerifyValue = useAppStore((s) =>
    writeVerifyToValue(
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)?.writeVerify ?? {
        mode: "off" as const,
        delayMs: null,
      },
    ),
  );
  const setSheetWriteVerify = useAppStore((s) => s.setSheetWriteVerify);
  // 本表地址变换配置（每表独立）：默认不调整（null）。
  const sheetAddressTransform = useAppStore(
    (s) =>
      s.workspace.sheets.find((sh) => sh.sheetId === sheetId)
        ?.addressTransform ?? null,
  );
  const setSheetAddressTransform = useAppStore(
    (s) => s.setSheetAddressTransform,
  );
  // 地址变换贡献：内置 builtin.address-adjust 恒在；工具栏按贡献渲染 OFF/ON。
  const addressTransformContributions =
    usePluginContributions<AddressTransformContribution>(
      host,
      "addressTransform",
    );
  // 活动协议：TCP 连接时工具栏值语义为 Unit ID（label 随之切换）；
  // 未连接/RTU 时恒为从站地址。
  const activeProtocol =
    host !== null && host !== undefined && connectionState === "connected"
      ? host.getCommProperties().protocol
      : "rtu";

  const handleReadAll = async (): Promise<void> => {
    if (host === null || host === undefined) return;
    const sheet = useAppStore
      .getState()
      .workspace.sheets.find((candidate) => candidate.sheetId === sheetId);
    if (sheet === undefined) return;
    const seq = ++readAllSeqRef.current;
    setReadAllRunning(true);
    const handle = host.readAllRows(
      rows.map((row) => ({
        key: row.rowId,
        sheetId,
        address: row.addressValue?.value ?? null,
        // 多寄存器范围行：一次 FC03 批量读取全部连续寄存器。
        ...(row.registerCount > 1 ? { quantity: row.registerCount } : {}),
      })),
      requestRouteForSheet(host, sheet),
    );
    readAllHandleRef.current = handle;
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
          cancelled: result.value.cancelledCount,
        },
        detail: null,
      });
      // 全局提示：富内容展示批次统计（成功/失败/跳过/取消 + 耗时），
      // 与底部面板消息并存；content 为 ReactNode，AntApp 上下文内渲染（i18n 可用）。
      message.open({
        content: <ReadAllResultMessage summary={result.value} />,
        duration: 5,
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
    // 竞态守卫：仅最新一次读取负责收尾（取消后重新读取时，过期 promise 不干预新状态）。
    if (seq === readAllSeqRef.current) {
      setReadAllRunning(false);
      readAllHandleRef.current = null;
    }
  };

  /** 取消运行中的全表读取：立即退出运行态，宿主导致 promise 落定后不再改状态。 */
  const handleCancelReadAll = (): void => {
    readAllHandleRef.current?.cancel();
    readAllSeqRef.current += 1;
    readAllHandleRef.current = null;
    setReadAllRunning(false);
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

  /** 读取选中行（F8）：与 ReadCell 按钮同一路径（row-io.readRowById），逐行执行。 */
  const handleReadSelectedRows = (): void => {
    if (host === null || host === undefined) return;
    for (const rowId of selectedRowIds) {
      void readRowById(host, rowId, { updateRow, recordManualResult });
    }
  };

  /** 写入选中行（Ctrl+Shift+Enter）：与 WriteCell 按钮同一路径（row-io.writeRowById）。 */
  const handleWriteSelectedRows = (): void => {
    if (host === null || host === undefined) return;
    for (const rowId of selectedRowIds) {
      void writeRowById(host, sheetId, rowId, {
        updateRow,
        recordManualResult,
        appendMessage,
      });
    }
  };

  /** 轮询启停（Alt+P）：切换选中行的 WP（与 WP 开关同一 store 动作 setPollingEnabled）。 */
  const togglePollingSelected = (): void => {
    const state = useAppStore.getState();
    const sheet = state.workspace.sheets.find((sh) => sh.sheetId === sheetId);
    for (const rowId of selectedRowIds) {
      const row = sheet?.rows.find((r) => r.rowId === rowId);
      if (row !== undefined) {
        setPollingEnabled(rowId, !row.pollingEnabled);
      }
    }
  };

  /** 方向键移动选中行（↑/↓）：沿表格渲染行顺序把选中行替换为相邻行（轻量，替换单选）。 */
  const handleArrowMoveSelection = (delta: 1 | -1): void => {
    if (rows.length === 0) return;
    const current =
      selectedRowIds.length > 0
        ? (selectedRowIds[selectedRowIds.length - 1] ?? null)
        : null;
    const currentIndex =
      current !== null ? rows.findIndex((r) => r.rowId === current) : -1;
    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = delta === 1 ? 0 : rows.length - 1;
    } else {
      nextIndex = Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
    }
    const nextRow = rows[nextIndex];
    if (nextRow !== undefined) {
      setSelectedRowIds([nextRow.rowId]);
    }
  };

  /**
   * 行级键盘：窗口级监听，仅在焦点不在单元格输入控件时触发（避免与单元格编辑/addressDraft 冲突），
   * 且仅作用于当前活动表（多标签页只响应一张表）。
   */
  const handleGlobalKeyDown = (event: KeyboardEvent): void => {
    // 弹窗打开时抑制快捷键（与 app 级 useGlobalShortcuts 同规则）：避免与弹窗内控件冲突。
    if (isAnyModalOpen()) return;
    // 活动表在事件回调时实时读取（不经响应式订阅）：多标签页下避免全部表因
    // activeSheetId 变化而重渲染（Tab 切换卡顿根因之一）。
    const store = useAppStore.getState();
    if (sheetId !== (store.activeSheetId ?? store.workspace.activeSheetId)) {
      return;
    }
    const target = event.target;
    // 仅忽略文本类编辑控件（单元格输入/备注/下拉/可编辑单元格非编辑态按钮），避免与编辑冲突；
    // 复选框/开关/按钮等选择控件不拦截快捷键（选中后可直接 Delete/Ctrl+C 等）。
    if (isTextInputTarget(target)) {
      return;
    }
    if (event.key === "Escape") {
      setMenuRowId(null);
      return;
    }
    // ---- 新增快捷键（PRD §8.3 P1，注册表驱动：keyboard/shortcuts.ts TABLE_SHORTCUTS）----
    if (matchesShortcut(event, tableShortcut("readAll").combo)) {
      event.preventDefault();
      if (readAllRunning) {
        handleCancelReadAll();
      } else {
        void handleReadAll();
      }
      return;
    }
    if (matchesShortcut(event, tableShortcut("readSelected").combo)) {
      event.preventDefault();
      handleReadSelectedRows();
      return;
    }
    if (matchesShortcut(event, tableShortcut("writeSelected").combo)) {
      event.preventDefault();
      handleWriteSelectedRows();
      return;
    }
    if (matchesShortcut(event, tableShortcut("togglePolling").combo)) {
      event.preventDefault();
      togglePollingSelected();
      return;
    }
    if (matchesShortcut(event, tableShortcut("restoreColumnLayout").combo)) {
      event.preventDefault();
      // 与 handleRestoreColumnLayout 同逻辑（内联避免 handleGlobalKeyDown 前向引用）。
      setColWidths({});
      colWidthsRef.current = {};
      setSheetColumnWidths(sheetId, {});
      setSheetColumnOrder(sheetId, null);
      return;
    }
    // 方向键行导航（↑/↓）：仅纯方向键（无修饰键），焦点在表格体内且非编辑态时移动选中行。
    const plainArrow =
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (plainArrow && !isArrowNavigationBlocked(target)) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        handleArrowMoveSelection(-1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        handleArrowMoveSelection(1);
        return;
      }
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
      // 撤销/重做（TECH_DESIGN §24.4）：Ctrl+Z 撤销、Ctrl+Shift+Z / Ctrl+Y 重做。
      // 与浏览器原生文本撤销区分：仅当焦点不在文本输入控件时触发（上方已守卫）。
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
        return;
      }
      if (key === "y") {
        event.preventDefault();
        store.redo();
        return;
      }
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

  /** 一键恢复本表列布局（列宽 + 列排序）为默认。
   *  colWidths 是本地拖拽 state（初值来自 store、不自动跟随 store 更新），恢复必须同时：
   *  清本地 state + 清镜像 ref（防止后续拖拽 handleResize / mouseup 提交读到旧值）+ 提交 store 持久化；
   *  列排序直接走 store（columnOrder 传 null 即回到默认顺序）。 */
  const handleRestoreColumnLayout = useCallback((): void => {
    setColWidths({});
    colWidthsRef.current = {};
    setSheetColumnWidths(sheetId, {});
    setSheetColumnOrder(sheetId, null);
  }, [setSheetColumnWidths, setSheetColumnOrder, sheetId]);

  // 本表是否存在自定义列布局（拖拽中的列宽或列序偏离默认）——决定恢复按钮禁用态。
  // 用本地 colWidths（而非仅 store 值）判断，可反映拖拽中的实时状态。
  const hasCustomColumnLayout =
    Object.keys(colWidths).length > 0 || columnOrder !== null;

  // 移动布局：与 MamepApp 同一断点；影响横向滚动下限、前两列固定、
  // 行高与列宽/列拖拽可用性。**必须定义在 baseColumns/columns 之前**（下方会用到）。
  const isMobileLayout = useIsMobileLayout();
  /** 行高（虚拟滚动与实测高度共用；移动端提高以满足触摸目标 ≥44dp）。 */
  const rowHeight = isMobileLayout ? MOBILE_ROW_HEIGHT : ROW_HEIGHT;

  const baseColumns = useMemo<ColumnType<RegisterRow>[]>(
    () => [
      {
        title: t("table.no"),
        key: "no",
        // 宽度自适应：No 单元格 = antd 树形展开图标（范围行「加号按钮」）
        // + 行号，按本表最大行号位数计算，保证单行完整显示（固定宽 40 时两位数换行撑高行）。
        // 仍属 FIXED_WIDTH_COLUMNS：不可表头拖拽、忽略 colWidths 持久化覆盖。
        width: computeNoColumnWidth(maxOrder),
        align: "center",
        className: "register-table__cell--no",
        render: (_, row) =>
          isVirtualRow(row) ? null : <NoCell order={row.order} />,
      },
      {
        title: t("table.tm"),
        key: "tm",
        width: 40,
        align: "center",
        render: (_, row) =>
          isVirtualRow(row) ? null : (
            <TmCell
              rowId={row.rowId}
              traceEnabled={row.traceEnabled}
              dataType={row.dataType}
              registerCount={row.registerCount}
            />
          ),
      },
      {
        title: t("table.name"),
        key: "name",
        width: 150,
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) =>
          isVirtualBitRow(row) ? (
            <BitNameCell row={row} writable={sheetWritable} />
          ) : isVirtualChildRow(row) ? (
            <ChildNameCell row={row} />
          ) : (
            <NameCell rowId={row.rowId} name={row.name} />
          ),
      },
      {
        title:
          registerRadix === "hex"
            ? t("table.addressHex")
            : t("table.addressDec"),
        key: "address",
        // 默认宽 144：等宽字体下表头 "Address[DEC]" 单行完整显示，且与 Name(150) 视觉协调。
        // 拖拽仍可自由调整（minWidth 80），此值仅默认宽度。
        width: 144,
        align: "center",
        className: "register-table__cell--center register-table__cell--mono",
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) =>
          isVirtualBitRow(row) ? (
            <BitRegisterCell row={row} radix={registerRadix} />
          ) : isVirtualChildRow(row) ? (
            <ChildAddressCell row={row} radix={registerRadix} />
          ) : (
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
        render: (_, row) =>
          isVirtualRow(row) ? null : (
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
        render: (_, row) =>
          isVirtualRow(row) ? null : (
            <ReadCell
              rowId={row.rowId}
              hasAddress={row.addressValue !== null}
              typeCountValid={isRowTypeCountValid(row)}
            />
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
        render: (_, row) =>
          isVirtualBitRow(row) ? (
            <BitDataCell row={row} writable={sheetWritable} />
          ) : isVirtualChildRow(row) ? (
            <ChildDataCell row={row} />
          ) : (
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
        render: (_, row) =>
          isVirtualRow(row) ? null : (
            <WriteCell
              sheetId={sheetId}
              rowId={row.rowId}
              hasAddress={row.addressValue !== null}
              typeCountValid={isRowTypeCountValid(row)}
            />
          ),
      },
      {
        title: t("table.type"),
        key: "type",
        // 默认宽 72：兼顾地址列紧凑性与进制下拉显示。进制下拉在窄列下省略显示；
        // 拖拽仍可自由调整（COLUMN_MIN_WIDTHS.type 已同步下调为 72，保证默认宽不被钳制）。
        width: 72,
        align: "center",
        className: "register-table__cell--center",
        render: (_, row) =>
          isVirtualBitRow(row) ? null : isVirtualChildRow(row) ? (
            <ChildTypeCell row={row} />
          ) : (
            <TypeCell
              rowId={row.rowId}
              dataType={row.dataType}
              {...(cellValidationErrors[`${row.rowId}:type`] !== undefined
                ? { error: cellValidationErrors[`${row.rowId}:type`] }
                : {})}
            />
          ),
      },
      {
        // Type scale 列：进制+scale 两列表达类型。
        title: t("table.scale"),
        key: "scale",
        width: 80,
        align: "center",
        className: "register-table__cell--center",
        render: (_, row) =>
          isVirtualBitRow(row) ? null : isVirtualChildRow(row) ? (
            <ChildScaleCell row={row} />
          ) : (
            <ScaleCell rowId={row.rowId} dataType={row.dataType} />
          ),
      },
      {
        title: t("table.comment"),
        key: "comment",
        // 单行不换行 + 超长省略 + hover title（框架列级 ellipsis，表头/正文统一生效）。
        ellipsis: true,
        render: (_, row) =>
          isVirtualBitRow(row) ? (
            <BitCommentCell row={row} writable={sheetWritable} />
          ) : isVirtualChildRow(row) ? (
            <ChildCommentCell row={row} />
          ) : (
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
        // 虚拟子行/位明细行不响应右键菜单（不可交互）。
        onCell: (record) => ({
          onContextMenu: isVirtualRow(record)
            ? undefined
            : (event) =>
                rowHandlersRef.current.onRowContextMenu(record.rowId, event),
        }),
        render: (_, row) =>
          isVirtualRow(row) ? null : (
            <DragHandle ariaLabel={t("table.dragHandle")} />
          ),
      },
    ],
    [t, registerRadix, cellValidationErrors, sheetId, maxOrder, sheetWritable],
  );
  const [startupColumnLimit, setStartupColumnLimit] = useState(
    deferBody && isMobileLayout ? 3 : Number.MAX_SAFE_INTEGER,
  );
  useEffect(() => {
    if (
      !deferBody ||
      !isMobileLayout ||
      startupColumnLimit >= baseColumns.length
    ) {
      return;
    }
    const timer = setTimeout(() => {
      startTransition(() => {
        setStartupColumnLimit((current) =>
          Math.min(baseColumns.length, current + 3),
        );
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [baseColumns.length, deferBody, isMobileLayout, startupColumnLimit]);

  // 合并拖拽列宽、按持久化列顺序重排，并挂载 onHeaderCell（供 HeaderCell 接收 id/width/onResize）。
  // - 列顺序：applyColumnOrder 按本表 columnOrder 重排（null=默认顺序）；缺失/新增列容错。
  // - 所有列都挂 onHeaderCell 返回 id（列拖拽 useSortable id）；仅「有默认宽且非固定宽」的可调列
  //   再附加 width/onResize/onResizeEnd（固定列/弹性列只提供 id：可排序、不可调宽）。
  // - 依赖 baseColumns + colWidths + columnOrder：拖拽只更新列定义，行级 MemoRow 比较器不含 columns，行不重渲染。
  const orderedColumns = useMemo<ColumnsType<RegisterRow>>(
    () =>
      applyColumnOrder(baseColumns, columnOrder).map((col) => {
        const key = col.key !== undefined ? String(col.key) : undefined;
        const fixed = key !== undefined && FIXED_WIDTH_COLUMNS.has(key);
        // 窄屏（移动布局）**不做任何列固定**（用户决策）：
        // 固定列在多列间横滑时占用可视宽度、且与触摸横滑手势争抢，
        // 故移动端与桌面保持一致（都不固定）。
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
          // 移动端禁用列宽调整（触摸下 mouse-only 手柄不可用且易误触）。
          const resizable =
            !fixed && cellWidth !== undefined && !isMobileLayout;
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
    [
      baseColumns,
      colWidths,
      columnOrder,
      handleResize,
      makeCommitColWidths,
      isMobileLayout,
    ],
  );
  const startupColumnsComplete =
    !deferBody || startupColumnLimit >= orderedColumns.length;
  useEffect(() => {
    if (startupColumnsComplete) markUiStartup("table-columns-ready");
  }, [startupColumnsComplete]);
  const columns = useMemo<ColumnsType<RegisterRow>>(
    () =>
      startupColumnsComplete
        ? orderedColumns
        : orderedColumns.slice(0, startupColumnLimit),
    [orderedColumns, startupColumnLimit, startupColumnsComplete],
  );

  // ---- 列拖拽排序----
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

  // 移动布局：列拖拽排序禁用（触摸下长按/拖动与横向滚动、长按行菜单互相冲突，
  // 且列序属于桌面端精细布局操作）；空 sensors 使列拖拽失效但保留键盘/无拖拽路径。
  // useMemo 包一层：保持引用稳定（否则下方 HeaderCell useMemo 的依赖不断变化）。
  const effectiveColumnSensors = useMemo(
    () => (isMobileLayout ? [] : columnSensors),
    [isMobileLayout, columnSensors],
  );

  // 行拖拽（仅最右拖拽手柄激活）：显式列出 sensors 以追加 TouchSensor（dnd-kit 默认不含触摸），
  // 长按 250ms 激活——避免与横向滚动、长按行菜单（500ms）互相干扰。
  const rowSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor),
  );

  // 列默认顺序的 key（columnOrder 为 null 时使用；列集合固定，标题变化不影响 key 顺序）。
  const defaultColumnKeys = useMemo(
    () => baseColumns.map((col) => String(col.key)),
    [baseColumns],
  );

  /**
   * 列拖拽结束：arrayMove 语义——把活动列移动到 over 列所在索引（只在这 11 个业务列间排序）。
   * 事件期从 store 实时读取当前列序（useAppStore.getState() 恒为最新），避免基于陈旧顺序计算
   * arrayMove—— 实测：连续拖拽后「被拖列落错位 + 未拖列被连带移动」的根因正是
   * 闭包/ref 滞后一帧（每次都基于上一次拖拽前的顺序重排，覆盖掉前面的结果）。
   */
  const handleColumnDragEnd = useCallback(
    ({ active, over }: DragEndEvent): void => {
      const overId = over?.id;
      if (overId === undefined || active.id === overId) return;
      const state = useAppStore.getState();
      const sheet = state.workspace.sheets.find((sh) => sh.sheetId === sheetId);
      const currentOrder = sheet?.columnOrder ?? defaultColumnKeys;
      const activeIndex = currentOrder.findIndex((key) => key === active.id);
      const overIndex = currentOrder.findIndex((key) => key === overId);
      if (activeIndex === -1 || overIndex === -1) return;
      state.setSheetColumnOrder(
        sheetId,
        arrayMove(currentOrder, activeIndex, overIndex),
      );
    },
    [defaultColumnKeys, sheetId],
  );

  // ---- 列拖拽上下文归属 ----
  // 列拖拽 DndContext + SortableContext(列) 只包表头 thead，行级 MemoRow 使用外层行拖拽
  // context，避免两种拖拽互相吞事件。wrapper 保持引用稳定；SortableContext 渲染期从 store
  // 实时读取列序，onDragEnd 也只依赖稳定的 sheetId 并从 store 读取最新值。
  // 列拖拽 DndContext 位于 <table> 内（包 thead），其无障碍元素（HiddenText/LiveRegion 两个 div）
  // 若内联渲染会成为 <table> 的直接子元素（非法 HTML + React 嵌套警告，破坏 e2e「无 console 错误」）。
  // 故经 accessibility.container 用 portal 渲染到 table 外的容器（document.body 常驻、无需创建/清理）。
  /** 表头列拖拽包装（仅包 thead）：列拖拽 DndContext + SortableContext 的唯一归属处。 */
  const ColumnDragHeader = useMemo(() => {
    const HeaderWrapper = (
      props: React.ThHTMLAttributes<HTMLTableSectionElement>,
    ): React.ReactNode => {
      // 渲染期实时读取 store（zustand getState 恒为最新已提交状态），与当前渲染列序保持一致。
      const state = useAppStore.getState();
      const sheet = state.workspace.sheets.find((sh) => sh.sheetId === sheetId);
      const columnKeys = sheet?.columnOrder ?? defaultColumnKeys;
      return (
        <DndContext
          sensors={effectiveColumnSensors}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleColumnDragEnd}
          collisionDetection={closestCenter}
          accessibility={{ container: document.body }}
        >
          <SortableContext
            items={columnKeys}
            strategy={horizontalListSortingStrategy}
          >
            <thead {...props} />
          </SortableContext>
        </DndContext>
      );
    };
    return HeaderWrapper;
  }, [sheetId, effectiveColumnSensors, defaultColumnKeys, handleColumnDragEnd]);

  // 当前列 key 顺序签名：仅随「列顺序」变化（列宽拖拽不变），驱动数据行在排序后同步重渲染。
  const columnOrderSignature = columns.map((col) => String(col.key)).join(",");

  // 行级 memo（性能优化）：rc-table 的 BodyRow 通过 immutable mark 随表根重渲染，
  // 这里对 <tr> 做引用级 memo——单行数据变化时仅该行重渲染，其余行跳过整个子树 reconcile。
  // 比较器只比较数据型 props（_record/_index/className），忽略函数型 props 与 style：
  // （onRow 事件闭包每次新建，经 rowHandlersRef 始终指向最新处理器；style 每次新建对象引用，
  // 本表不设行样式，选中/悬停类经 className 按字符串值比较传递）。
  // 依赖与 columns useMemo 一致：任一外部渲染依赖变化时重建行组件，强制全行重渲染，避免陈旧内容。
  // 虚拟子行不注册 useSortable：不可拖拽（不在 SortableContext items 中），
  // 虚拟模式用 div、非虚拟小表用 tr（hooks 规则：useSortable 只在 SortableRow 内调用）。
  const MemoRow = useMemo(() => {
    const SortableRow = forwardRef<HTMLElement, MemoTableRowProps>(
      function SortableRow(props, ref) {
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
          (node: HTMLElement | null) => {
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
            {virtualScrollingEnabled ? (
              <div
                {...rest}
                {...(isEmpty ? {} : attributes)}
                ref={setRefs}
                style={style}
                role="row"
                tabIndex={-1}
              />
            ) : (
              <tr
                {...rest}
                {...(isEmpty ? {} : attributes)}
                ref={setRefs}
                style={style}
                role="row"
                tabIndex={-1}
              />
            )}
          </RowContext.Provider>
        );
      },
    );
    SortableRow.displayName = "RegisterTableSortableRow";

    /** 虚拟子行：普通 <tr>，无 dnd-kit（不可拖拽），只读展示。 */
    const ChildRow = forwardRef<HTMLElement, MemoTableRowProps>(
      function ChildRow(props, ref) {
        const { _record, _index, _selection, _colOrder, ...rest } = props;
        void _record;
        void _index;
        void _selection;
        void _colOrder;
        const setRefs = (node: HTMLElement | null): void => {
          if (typeof ref === "function") ref(node);
          else if (ref !== null && ref !== undefined) ref.current = node;
        };
        return virtualScrollingEnabled ? (
          <div {...rest} ref={setRefs} role="row" tabIndex={-1} />
        ) : (
          <tr {...rest} ref={setRefs} role="row" tabIndex={-1} />
        );
      },
    );
    ChildRow.displayName = "RegisterTableChildRow";

    const MemoizedTr = memo(
      forwardRef<HTMLElement, MemoTableRowProps>(
        function RegisterTableRow(props, ref) {
          // 虚拟子行/位明细行：普通 <tr>（无 useSortable）；普通行走对应行实现。
          if (isVirtualRow(props._record)) {
            return <ChildRow {...props} ref={ref} />;
          }
          return <SortableRow {...props} ref={ref} />;
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
  }, [virtualScrollingEnabled]);

  /**
   * 工具栏次要控件组：地址进制 / 从站地址(Unit ID) / 写后回读 /
   * 表级 Address Adjust / 恢复列布局 / 行数。
   *
   * 桌面（≥ 1024px）直接铺在工具栏右侧；移动端收进「更多」Popover 面板——**同一份 JSX
   * 复用**，避免桌面/移动两套实现漂移（漏改一处就是功能缺失）。
   */
  const secondaryToolbarGroup = (
    <div className="table-toolbar__group">
      <Tooltip title={t("table.addressFormatHint")}>
        <span className="table-toolbar__radix">
          <span className="table-toolbar__radix-label">
            {t("table.addressRadixLabel")}
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
      <Tooltip
        title={
          activeProtocol === "tcp"
            ? t("table.unitIdHint")
            : t("table.slaveAddressHint")
        }
      >
        <span className="table-toolbar__slave">
          <span className="table-toolbar__slave-label">
            {activeProtocol === "tcp"
              ? t("table.unitId")
              : t("table.slaveAddress")}
          </span>
          <InputNumber
            size="small"
            aria-label={
              activeProtocol === "tcp"
                ? t("table.unitId")
                : t("table.slaveAddress")
            }
            min={0}
            max={255}
            value={slaveAddress}
            onChange={(v) => setSheetSlaveAddress(sheetId, v ?? 1)}
            style={{ width: 64 }}
          />
        </span>
      </Tooltip>
      <Tooltip title={t("table.writeVerifyHint")}>
        <span className="table-toolbar__verify">
          <span className="table-toolbar__verify-label">
            {t("table.writeVerifyLabel")}
          </span>
          <DeferredSelect
            size="small"
            aria-label={t("table.writeVerify")}
            style={{ width: 116 }}
            value={writeVerifyValue}
            onChange={(value) => {
              const option = WRITE_VERIFY_OPTIONS.find(
                (o) => o.value === value,
              );
              if (option !== undefined) {
                setSheetWriteVerify(sheetId, option.settings);
              }
            }}
            options={WRITE_VERIFY_OPTIONS.map((o) => ({
              value: o.value,
              label:
                o.value === "off" || o.value === "immediate"
                  ? t(writeVerifyOptionLabel(o.value))
                  : t(writeVerifyOptionLabel(o.value), {
                      ms: writeVerifyOptionMs(o.value),
                    }),
            }))}
          />
        </span>
      </Tooltip>
      {/* 表级 Address Adjust：每表独立 OFF/ON；
              选项来自 addressTransform 贡献（内置恒在），仅 RTU 显示。 */}
      {activeProtocol === "rtu" && addressTransformContributions.length > 0 ? (
        <Tooltip title={t("table.addressAdjustHint")}>
          <span className="table-toolbar__adjust">
            <span className="table-toolbar__adjust-label">
              {t("table.addressAdjust")}
            </span>
            <Segmented
              size="small"
              aria-label={t("table.addressAdjust")}
              value={sheetAddressTransform?.enabled ? "on" : "off"}
              onChange={(value) => {
                const transform = addressTransformContributions[0]?.payload;
                setSheetAddressTransform(
                  sheetId,
                  value === "on" && transform !== undefined
                    ? {
                        transformId: transform.id,
                        enabled: true,
                      }
                    : null,
                );
              }}
              options={[
                { value: "off", label: t("table.addressAdjustOff") },
                { value: "on", label: t("table.addressAdjustOn") },
              ]}
            />
          </span>
        </Tooltip>
      ) : null}
      <Tooltip title={t("table.restoreColumnLayoutHint")}>
        <Button
          size="small"
          icon={<ColumnWidthOutlined />}
          disabled={!hasCustomColumnLayout}
          onClick={handleRestoreColumnLayout}
        >
          {t("table.restoreColumnLayout")}
        </Button>
      </Tooltip>
      <span className="table-toolbar__info">
        {t("table.rowCount", { count: rows.length })}
      </span>
    </div>
  );

  return (
    <MobileNativeSelectContext.Provider value={isMobileLayout}>
      <Flex
        vertical
        style={{ height: "100%" }}
        ref={flexRef}
        data-startup-hydrated={tableReady && startupColumnsComplete}
      >
        <div className="table-toolbar">
          <div className="table-toolbar__group">
            <Tooltip title={t("table.undoHint")}>
              <Button
                size="small"
                icon={<UndoOutlined />}
                disabled={!canUndo}
                onClick={undo}
                aria-label={t("table.undo")}
              >
                {t("table.undo")}
              </Button>
            </Tooltip>
            <Tooltip title={t("table.redoHint")}>
              <Button
                size="small"
                icon={<RedoOutlined />}
                disabled={!canRedo}
                onClick={redo}
                aria-label={t("table.redo")}
              >
                {t("table.redo")}
              </Button>
            </Tooltip>
          </div>
          <span className="table-toolbar__sep" aria-hidden="true" />
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
            {readAllRunning ? (
              <Button
                size="small"
                icon={<StopOutlined />}
                onClick={handleCancelReadAll}
                aria-label={t("table.cancelReadAll")}
              >
                {t("table.cancelReadAll")}
              </Button>
            ) : null}
          </div>
          <span className="table-toolbar__spacer" />
          {/* 移动端：次要控件收进「更多」面板，避免工具栏换行挤压表格；
            桌面端保持直接铺开（大屏一步到位，不增加点击成本）。 */}
          {isMobileLayout ? (
            <Popover
              trigger="click"
              placement="bottomRight"
              content={
                <div className="table-toolbar__more">
                  {secondaryToolbarGroup}
                </div>
              }
            >
              <Button
                size="small"
                icon={<MoreOutlined />}
                aria-label={t("table.toolbarMoreLabel")}
              >
                {t("table.toolbarMore")}
              </Button>
            </Popover>
          ) : (
            secondaryToolbarGroup
          )}
          {toolbarActions.length > 0 ? (
            <>
              <span className="table-toolbar__sep" aria-hidden="true" />
              <div className="table-toolbar__group table-toolbar__plugins">
                {toolbarActions.map((action) => {
                  // 插件外部化：动作可用性由插件 runtime 是否声明 handler 决定
                  // （安川 ROM/RAM 确定指令由插件自身承载；声明式占位动作置灰）。
                  const canHandle =
                    host?.pluginRegistry.canHandleToolbarAction(
                      action.pluginId,
                      action.payload.id,
                    ) ?? false;
                  return (
                    <Tooltip
                      key={action.payload.id}
                      title={
                        canHandle
                          ? t(action.payload.titleKey)
                          : t("plugins.toolbarActionPlaceholder")
                      }
                    >
                      <Button
                        size="small"
                        disabled={!canHandle}
                        aria-label={t(action.payload.titleKey)}
                        data-testid={`plugin-toolbar-action-${action.payload.id}`}
                        onClick={() => handlePluginToolbarAction(action)}
                      >
                        {t(action.payload.titleKey)}
                      </Button>
                    </Tooltip>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
        {tableReady ? (
          <DndContext
            modifiers={[restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            sensors={rowSensors}
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
                  {/* 斑马纹：按行号奇偶交替打类（antd Table 内置能力 rowClassName）。
                  该类经 rc-table 作为 className 传入自定义行组件 MemoRow（...rest 透传），
                  MemoRow 的 memo 比较器已按字符串值比较 className，不会破坏行级性能优化。
                  样式见 apps/web/src/index.css 的 register-table__row--striped 规则。 */}
                  <Table<RegisterRow>
                    size="small"
                    rowKey="rowId"
                    columns={columns}
                    dataSource={treeRows}
                    pagination={false}
                    bordered
                    rowClassName={(_record, index) =>
                      isVirtualBitRow(_record)
                        ? "register-table__row--bit"
                        : isVirtualChildRow(_record)
                          ? "register-table__row--child"
                          : index % 2 === 1
                            ? "register-table__row--striped"
                            : ""
                    }
                    // antd v6 Virtual BodyGrid 支持先扁平化 tree children，再渲染可见行。
                    virtual={virtualScrollingEnabled}
                    {...(tableBodyHeight > 0 ||
                    rows.length > virtualScrollThreshold
                      ? ({
                          style: { flex: 1, minHeight: 0 },
                          listItemHeight: rowHeight,
                        } as RegisterTableVirtualProps)
                      : {})}
                    scroll={{
                      x: isMobileLayout ? MOBILE_SCROLL_X : 920,
                      // 虚拟表 scroll.y 必须为数字：隐藏未测量表（tableBodyHeight=0）用兜底高度，
                      // 显示后由 ResizeObserver 校正。否则 rc-table 虚拟渲染失败（0 行 + 报错复现）。
                      ...(tableBodyHeight > 0 ||
                      rows.length > virtualScrollThreshold
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
                      // 虚拟子行/位明细行：不可多选（复选框禁用）。
                      getCheckboxProps: (record) => ({
                        disabled: isVirtualRow(record),
                      }),
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
                      header: {
                        wrapper: ColumnDragHeader,
                        cell: HeaderCell,
                      },
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
              </div>
            </Dropdown>
          </DndContext>
        ) : (
          <div
            className="register-table-startup"
            role="status"
            aria-label={t("app.loading")}
          >
            <Typography.Text type="secondary">
              {t("app.loading")}
            </Typography.Text>
          </div>
        )}
      </Flex>
    </MobileNativeSelectContext.Provider>
  );
});

/**
 * 启动外壳与重表体之间的最后一道调度边界：生产启动先提交轻量占位，再让包含大量
 * selector、DnD 和 antd Table 的内部组件在独立 transition 中挂载。
 * 测试与嵌入式场景不设置 `deferBody` 时保持同步渲染。
 */
export const RegisterTable = memo(function RegisterTable(
  props: RegisterTableProps,
) {
  const { t } = useTranslation();
  const staged = useAfterFirstPaint(props.deferBody === true);
  if (props.deferBody === true && !staged) {
    return (
      <div
        className="register-table-startup"
        role="status"
        aria-label={t("app.loading")}
      >
        <Typography.Text type="secondary">{t("app.loading")}</Typography.Text>
      </div>
    );
  }
  return <RegisterTableContent {...props} />;
});
