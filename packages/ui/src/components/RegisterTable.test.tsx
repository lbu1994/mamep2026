/**
 * RegisterTable 三态状态点渲染测试（jsdom）。
 * 失败态渲染路径与成功态同构（同一 RowStatusDot），此处重点验证：
 * - 失败态：红点 + Tooltip/aria-label 承载原因（messageKey 渲染）
 * - 编辑完成态：灰点 + aria-label「已编辑，未同步到设备」
 * - 编辑态隐藏：进入编辑后状态点不显示（由 EditableCellValue trailing 控制）
 * 逻辑正确性（成功/失败/幂等/清除）由 row-result.test.ts 与 app-store.test.ts 覆盖。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BatchReadHandle, BatchReadSummary } from "@mamep2026/communication";
import {
  createEmptyWorkspace,
  ok,
  type Result,
  type RowId,
  type SheetId,
  type Workspace,
} from "@mamep2026/domain";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { AppHost } from "../host";
import { RegisterTable } from "./RegisterTable";

// jsdom 未实现 ResizeObserver（RegisterTable 用它测量表体高度）；最小 stub。
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function sheetId(): SheetId {
  const id = useAppStore.getState().workspace.sheets[0]?.sheetId;
  if (id === undefined) throw new Error("missing sheet");
  return id;
}

function firstRowId(): RowId {
  const rowId = useAppStore.getState().workspace.sheets[0]?.rows[0]?.rowId;
  if (rowId === undefined) throw new Error("missing row");
  return rowId;
}

/** 构造当前第一行的成功点对象（Record key 需显式 RowId 类型，避免字面量推断为 string）。 */
function buildRowSuccess(
  kind: "read" | "write",
): Record<RowId, { kind: "read" | "write" } | undefined> {
  return { [firstRowId()]: { kind } };
}

describe("RegisterTable 三态状态点", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: useAppStore.getState().workspace,
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
    });
  });

  it("失败态：Data 列渲染红点，aria-label 承载 i18n 原因", () => {
    useAppStore.setState({
      rowResults: {
        [firstRowId()]: {
          messageKey: "errors.requestTimeout",
          detail: "REQUEST_TIMEOUT",
        },
      },
    });
    render(<RegisterTable sheetId={sheetId()} />);
    expect(
      document.querySelector(".register-table__status-dot--error"),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("No response from the device within the timeout."),
    ).toBeTruthy();
  });

  it("编辑完成态：Data 列渲染灰点与 aria-label", () => {
    useAppStore.setState({ rowDirty: { [firstRowId()]: true } });
    render(<RegisterTable sheetId={sheetId()} />);
    expect(
      document.querySelector(".register-table__status-dot--dirty"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Edited, not synced to device")).toBeTruthy();
  });

  it("成功态：Data 列渲染绿点与「Read successful」", () => {
    useAppStore.setState({
      rowSuccess: buildRowSuccess("read"),
    });
    render(<RegisterTable sheetId={sheetId()} />);
    expect(
      document.querySelector(".register-table__status-dot--success"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Read successful")).toBeTruthy();
  });

  it("优先级：失败态 > 编辑完成态 > 成功态（同时存在只渲染一个点）", () => {
    useAppStore.setState({
      rowResults: {
        [firstRowId()]: {
          messageKey: "errors.requestTimeout",
          detail: null,
        },
      },
      rowDirty: { [firstRowId()]: true },
      rowSuccess: buildRowSuccess("read"),
    });
    render(<RegisterTable sheetId={sheetId()} />);
    const dots = document.querySelectorAll(".register-table__status-dot");
    expect(dots).toHaveLength(1);
    expect(
      document.querySelector(".register-table__status-dot--error"),
    ).toBeTruthy();
  });

  it("失败后编辑 Data：失败态清除并显示编辑完成态（回归：红点不压过灰点）", async () => {
    useAppStore.setState({
      rowResults: {
        [firstRowId()]: {
          messageKey: "errors.requestTimeout",
          detail: null,
        },
      },
    });
    render(<RegisterTable sheetId={sheetId()} />);
    // 初始：失败态红点。
    expect(
      document.querySelector(".register-table__status-dot--error"),
    ).toBeTruthy();
    // 编辑第一行 Data（点击 wrap 进入编辑态 → 第一行元素变为 Input）。
    const cell = screen.getAllByLabelText("Data")[0];
    if (cell === undefined) throw new Error("missing data cell");
    fireEvent.click(cell);
    const input = screen.getAllByLabelText("Data")[0];
    if (input === undefined) throw new Error("missing data input");
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      // 编辑提交后：失败态清除、编辑完成态显示（红点 → 灰点）。
      expect(
        document.querySelector(".register-table__status-dot--error"),
      ).toBeNull();
      expect(
        document.querySelector(".register-table__status-dot--dirty"),
      ).toBeTruthy();
    });
  });

  it("编辑态隐藏：进入 Data 编辑后状态点不显示（trailing 仅非编辑态渲染）", async () => {
    useAppStore.setState({
      rowResults: {
        [firstRowId()]: {
          messageKey: "errors.requestTimeout",
          detail: null,
        },
      },
    });
    render(<RegisterTable sheetId={sheetId()} />);
    // 每行一个 Data 单元格（aria-label 相同），取第一行。
    const cell = screen.getAllByLabelText("Data")[0];
    if (cell === undefined) throw new Error("missing data cell");
    fireEvent.click(cell);
    await waitFor(() => {
      // 编辑态：Input 出现，状态点消失（trailing 仅非编辑态渲染）。
      expect(
        document.querySelector(".register-table__status-dot--error"),
      ).toBeNull();
      expect(document.querySelector('input[aria-label="Data"]')).toBeTruthy();
    });
  });
});

describe("RegisterTable 单元格校验（回归：Data 列编辑校验恢复）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      // 重置 workspace：避免前一个测试改过的 cellText/addressDraft 残留导致
      // 编辑草稿与显示值相同而短路（draft === value 不触发提交）。
      workspace: createEmptyWorkspace(),
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  /** 编辑第 index 行 Data 列提交指定值。 */
  async function commitDataCell(index: number, value: string): Promise<void> {
    const cell = screen.getAllByLabelText("Data")[index];
    if (cell === undefined) throw new Error("missing data cell");
    fireEvent.click(cell);
    const input = screen.getAllByLabelText("Data")[index];
    if (input === undefined) throw new Error("missing data input");
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  }

  it("Data 列提交非法值：非编辑态出现 error 样式（红框+Tooltip），输入被保留", async () => {
    render(<RegisterTable sheetId={sheetId()} />);
    // 默认 dataType=hex；"zz" 非法（DATA_HEX_INVALID）。
    await commitDataCell(0, "zz");
    await waitFor(() => {
      expect(
        document.querySelector(
          ".register-table__editable-cell-value-wrap--error",
        ),
      ).toBeTruthy();
    });
    // 输入被保留（§23 校验失败不清空用户输入）。
    expect(screen.getAllByLabelText("Data")[0]?.textContent).toBe("zz");
    // 非法值不产生编辑完成态（灰点）。
    expect(
      document.querySelector(".register-table__status-dot--dirty"),
    ).toBeNull();
  });

  it("Data 列提交非法值后再次合法提交：error 样式消失", async () => {
    render(<RegisterTable sheetId={sheetId()} />);
    await commitDataCell(0, "zz");
    await waitFor(() => {
      expect(
        document.querySelector(
          ".register-table__editable-cell-value-wrap--error",
        ),
      ).toBeTruthy();
    });
    await commitDataCell(0, "1F");
    await waitFor(() => {
      expect(
        document.querySelector(
          ".register-table__editable-cell-value-wrap--error",
        ),
      ).toBeNull();
    });
  });

  it("地址列已有合法地址后提交非法值：同样出现 error 样式（回归：addressValue 非空时校验红字丢失）", async () => {
    // 先给第一行提交合法地址（默认表 radix=dec，"100" 合法）。
    useAppStore.getState().commitRowAddress(firstRowId(), "100");
    render(<RegisterTable sheetId={sheetId()} />);
    const cell = screen.getAllByLabelText("Register")[0];
    if (cell === undefined) throw new Error("missing register cell");
    fireEvent.click(cell);
    const input = screen.getAllByLabelText("Register")[0];
    if (input === undefined) throw new Error("missing register input");
    fireEvent.change(input, { target: { value: "xyz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        document.querySelector(
          ".register-table__editable-cell-value-wrap--error",
        ),
      ).toBeTruthy();
    });
    // 非法输入被保留。
    expect(screen.getAllByLabelText("Register")[0]?.textContent).toBe("xyz");
  });
});

describe("RegisterTable 斑马纹（rowClassName 按行号奇偶交替）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: createEmptyWorkspace(),
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  it("奇数行带 register-table__row--striped、偶数行不带", () => {
    render(<RegisterTable sheetId={sheetId()} />);
    // 只取真实数据行（排除 ant-table-measure-row / ant-table-placeholder）。
    // 注意：隔离渲染没有上层 Tabs 的 .register-table-tabs 祖先类，选择器不加该前缀。
    const rows = Array.from(
      document.querySelectorAll(".ant-table-tbody > tr.ant-table-row"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    rows.forEach((row, index) => {
      expect(row.classList.contains("register-table__row--striped")).toBe(
        index % 2 === 1,
      );
    });
  });
});

describe("RegisterTable 全表读取取消（ADR-025）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: createEmptyWorkspace(),
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  it("运行态出现取消按钮，点击调用 handle.cancel 并立即退出运行态；promise 落定后汇总照常追加", async () => {
    let cancelCalls = 0;
    const deferred: {
      resolve: ((r: Result<BatchReadSummary>) => void) | null;
    } = { resolve: null };
    const fakeHost = {
      readAllRows: vi.fn(
        (): BatchReadHandle =>
          ({
            promise: new Promise<Result<BatchReadSummary>>((resolve) => {
              // 包装一层：Promise resolve 接受 Result | PromiseLike，收窄为目标函数类型。
              deferred.resolve = (r) => resolve(r);
            }),
            cancel: vi.fn(() => {
              cancelCalls += 1;
            }),
          }) as BatchReadHandle,
      ),
      // 工具栏「从站地址 / Unit ID」label 需读活动协议（2026-08-25）。
      getCommProperties: vi.fn(() => ({
        protocol: "rtu" as const,
        portLabel: null,
        unitId: null,
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
        timeoutMs: 1000,
        retryCount: 1,
        rxDelayMs: 50,
        addressAdjust: "off",
        connectionState: "connected",
      })),
    } as unknown as AppHost;
    // 小工作区（jsdom 渲染 50 行过慢易超时）：仅保留首表前 3 行。
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) sheet.rows = sheet.rows.slice(0, 3);
    useAppStore.setState({ host: fakeHost, workspace });

    render(<RegisterTable sheetId={sheetId()} />);
    // antd 图标计入可访问名（如 "reload Read All"），用正则匹配。
    fireEvent.click(screen.getByRole("button", { name: /Read All/ }));

    // 运行态：取消按钮出现。
    const cancelButton = screen.getByRole("button", { name: /Cancel/ });
    expect(cancelButton).toBeTruthy();

    // 点击取消：handle.cancel 被调用、取消按钮立即消失（不等 promise resolve）。
    fireEvent.click(cancelButton);
    expect(cancelCalls).toBe(1);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
    });

    // 取消后 promise 落定：汇总消息（含 cancelled）照常追加，不抛错、不改运行态。
    deferred.resolve?.(
      ok({
        batchId: "b-1",
        totalRows: 1,
        eligibleRows: 1,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        cancelledCount: 1,
        startedAt: 0,
        completedAt: 1,
        durationMs: 1,
      }),
    );
    await waitFor(() => {
      const messages = useAppStore.getState().messages;
      expect(messages.at(-1)?.messageKey).toBe("table.batchSummary");
    });
  });
});

describe("RegisterTable 工具栏地址 label（2026-08-25 TCP Unit ID 会话内动态修改）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: createEmptyWorkspace(),
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  function makeHost(protocol: "rtu" | "tcp"): AppHost {
    return {
      getCommProperties: vi.fn(() => ({
        protocol,
        portLabel: protocol === "tcp" ? "192.168.1.10:502" : null,
        unitId: protocol === "tcp" ? 1 : null,
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
        timeoutMs: 1000,
        retryCount: 1,
        rxDelayMs: 50,
        addressAdjust: "off",
        connectionState: "connected",
      })),
    } as unknown as AppHost;
  }

  function smallWorkspace(): Workspace {
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) sheet.rows = sheet.rows.slice(0, 3);
    return workspace;
  }

  it("TCP 连接时工具栏 label 显示 Unit ID（InputNumber aria-label 同步）", () => {
    const workspace = smallWorkspace();
    useAppStore.setState({ host: makeHost("tcp"), workspace });
    render(<RegisterTable sheetId={sheetId()} />);
    expect(screen.getByLabelText("Unit ID")).toBeTruthy();
    expect(screen.queryByLabelText("Slave Address")).toBeNull();
  });

  it("RTU 连接时工具栏 label 保持 Slave Address", () => {
    const workspace = smallWorkspace();
    useAppStore.setState({ host: makeHost("rtu"), workspace });
    render(<RegisterTable sheetId={sheetId()} />);
    expect(screen.getByLabelText("Slave Address")).toBeTruthy();
    expect(screen.queryByLabelText("Unit ID")).toBeNull();
  });
});

describe("RegisterTable 工具栏写后回读配置（2026-08-26）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: createEmptyWorkspace(),
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  it("默认渲染 ON（立即回读）；切换「ON 200 ms」更新本表 writeVerify", async () => {
    const sid = sheetId();
    expect(useAppStore.getState().workspace.sheets[0]?.writeVerify).toEqual({
      mode: "immediate",
      delayMs: null,
    });
    render(<RegisterTable sheetId={sid} />);
    // aria-label 来自 i18n table.writeVerify。
    const verifySelect = screen.getByLabelText("Write verification");
    expect(verifySelect).toBeTruthy();
    // 打开下拉，选择「ON 200 ms」。
    fireEvent.mouseDown(verifySelect);
    await waitFor(() => {
      expect(
        document.querySelectorAll(".ant-select-item-option").length,
      ).toBeGreaterThanOrEqual(5);
    });
    const option = Array.from(
      document.querySelectorAll(".ant-select-item-option"),
    ).find((o) => o.textContent?.includes("ON 200 ms"));
    if (option === undefined) throw new Error("missing ON 200 ms option");
    fireEvent.click(option);
    await waitFor(() => {
      expect(useAppStore.getState().workspace.sheets[0]?.writeVerify).toEqual({
        mode: "delayed",
        delayMs: 200,
      });
    });
  });

  it("写后回读配置随表隔离：切换 A 表不影响 B 表", async () => {
    useAppStore.getState().addSheet();
    const first = useAppStore.getState().workspace.sheets[0]?.sheetId;
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (first === undefined || second === undefined) {
      throw new Error("missing sheets");
    }
    useAppStore.getState().setSheetWriteVerify(first, {
      mode: "delayed",
      delayMs: 500,
    });
    render(<RegisterTable sheetId={first} />);
    // 打开下拉，选择「ON 200 ms」只影响当前表。
    const verifySelect = screen.getByLabelText("Write verification");
    fireEvent.mouseDown(verifySelect);
    await waitFor(() => {
      expect(
        document.querySelectorAll(".ant-select-item-option").length,
      ).toBeGreaterThanOrEqual(5);
    });
    const option = Array.from(
      document.querySelectorAll(".ant-select-item-option"),
    ).find((o) => o.textContent?.includes("ON 200 ms"));
    if (option === undefined) throw new Error("missing ON 200 ms option");
    fireEvent.click(option);
    await waitFor(() => {
      expect(
        useAppStore
          .getState()
          .workspace.sheets.find((s) => s.sheetId === first)?.writeVerify,
      ).toEqual({ mode: "delayed", delayMs: 200 });
    });
    // 第二张表仍为默认 immediate。
    expect(
      useAppStore
        .getState()
        .workspace.sheets.find((s) => s.sheetId === second)?.writeVerify,
    ).toEqual({ mode: "immediate", delayMs: null });
  });
});
