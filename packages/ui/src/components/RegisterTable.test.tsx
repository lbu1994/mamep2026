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
import {
  createEmptyWorkspace,
  type RowId,
  type SheetId,
} from "@mamep2026/domain";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
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
