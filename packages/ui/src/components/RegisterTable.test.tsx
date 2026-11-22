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
import userEvent from "@testing-library/user-event";
// AntApp：RegisterTable 使用 App.useApp()（antd message）。antd 的 useApp
// 无 <App> context 时返回空对象、不抛错（useContext 默认值），因此不调用 message 的既有
// 测试无需包裹；仅 Read All 成功路径会调用 message.open，此类测试须包 <AntApp>
// （同 BottomPanel.test.tsx 约定）。
import { App as AntApp } from "antd";
import type {
  BatchReadHandle,
  BatchReadSummary,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import {
  createEmptyWorkspace,
  ok,
  RegisterAddress,
  type Result,
  type RowId,
  type SheetId,
  type Workspace,
} from "@mamep2026/domain";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { AppHost } from "../host";
import { PluginRegistry } from "@mamep2026/plugin-api";
import {
  ADDRESS_TRANSFORM_CONTRIBUTION_SCHEMA,
  ContributionPointRegistry,
} from "@mamep2026/plugin-api";
import { computeNoColumnWidth } from "../no-column-width";
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

async function openTableSettings(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Table settings" }));
  return screen.findByRole("dialog", { name: "Table settings" });
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
    const cell = screen.getAllByLabelText("Address")[0];
    if (cell === undefined) throw new Error("missing register cell");
    fireEvent.click(cell);
    const input = screen.getAllByLabelText("Address")[0];
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
    expect(screen.getAllByLabelText("Address")[0]?.textContent).toBe("xyz");
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

describe("RegisterTable 行级可访问名称", () => {
  beforeEach(() => {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) {
      const firstAddress = RegisterAddress.create(0);
      const secondAddress = RegisterAddress.create(1000);
      sheet.rows = sheet.rows.slice(0, 3).map((row, index) => ({
        ...row,
        addressDraft:
          index === 0 ? "0" : index === 1 ? "1000" : row.addressDraft,
        addressValue:
          index === 0
            ? firstAddress.ok
              ? firstAddress.value
              : null
            : index === 1
              ? secondAddress.ok
                ? secondAddress.value
                : null
              : null,
        registerCount: 1,
        registers: null,
      }));
    }
    useAppStore.setState({
      host: null,
      workspace,
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      pollingOutcomes: {},
      cellValidationErrors: {},
    });
  });

  it("TM/WP/Read/Write 名称携带行号和地址，空地址退回行号", () => {
    render(<RegisterTable sheetId={sheetId()} />);

    expect(
      screen.getByRole("switch", { name: "Poll row 1, address 0" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Read row 1, address 0" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Write row 1, address 0" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Trace row 1, address 0" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Poll row 2, address 1000" }),
    ).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Poll row 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Read row 3" })).toBeTruthy();
  });

  it("地址和行序变化后名称同步重算", async () => {
    render(<RegisterTable sheetId={sheetId()} />);

    useAppStore.getState().commitRowAddress(firstRowId(), "2000");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Read row 1, address 2000" }),
      ).toBeTruthy();
    });

    useAppStore.getState().moveRow(sheetId(), firstRowId(), "down");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Read row 2, address 2000" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Read row 1, address 1000" }),
      ).toBeTruthy();
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
      // 工具栏「从站地址 / Unit ID」label 需读活动协议。
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
        connectionState: "connected",
      })),
    } as unknown as AppHost;
    // 小工作区（jsdom 渲染 50 行过慢易超时）：仅保留首表前 3 行。
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) sheet.rows = sheet.rows.slice(0, 3);
    useAppStore.setState({ host: fakeHost, workspace });

    // promise 落定走成功路径会调用 message.open：须包 <AntApp>。
    render(
      <AntApp>
        <RegisterTable sheetId={sheetId()} />
      </AntApp>,
    );
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

  it("TCP 连接时设置面板 label 显示 Unit ID（InputNumber aria-label 同步）", async () => {
    const workspace = smallWorkspace();
    useAppStore.setState({ host: makeHost("tcp"), workspace });
    render(<RegisterTable sheetId={sheetId()} />);
    await openTableSettings();
    expect(screen.getByLabelText("Unit ID")).toBeTruthy();
    expect(screen.queryByLabelText("Slave Address")).toBeNull();
  });

  it("RTU 连接时设置面板 label 保持 Slave Address", async () => {
    const workspace = smallWorkspace();
    useAppStore.setState({ host: makeHost("rtu"), workspace });
    render(<RegisterTable sheetId={sheetId()} />);
    await openTableSettings();
    expect(screen.getByLabelText("Slave Address")).toBeTruthy();
    expect(screen.queryByLabelText("Unit ID")).toBeNull();
  });
});

describe("RegisterTable Table settings 键盘交互（2026-11-22）", () => {
  beforeEach(() => {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) sheet.rows = sheet.rows.slice(0, 3);
    useAppStore.setState({
      host: null,
      workspace,
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  it("键盘打开后聚焦面板，可 Tab 遍历，Escape 关闭并恢复触发器焦点", async () => {
    const user = userEvent.setup();
    render(<RegisterTable sheetId={sheetId()} />);
    const trigger = screen.getByRole("button", { name: "Table settings" });
    trigger.focus();

    await user.keyboard("{Enter}");
    const panel = await screen.findByRole("dialog", {
      name: "Table settings",
    });
    await waitFor(() => expect(document.activeElement).toBe(panel));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close table settings" }),
    );
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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

  it("默认渲染 OFF（不回读）；切换「ON 200 ms」更新本表 writeVerify", async () => {
    const sid = sheetId();
    expect(useAppStore.getState().workspace.sheets[0]?.writeVerify).toEqual({
      mode: "off",
      delayMs: null,
    });
    render(<RegisterTable sheetId={sid} />);
    await openTableSettings();
    // aria-label 来自 i18n table.writeVerify。
    const verifySelect = screen.getByLabelText("Write verification");
    expect(verifySelect).toBeTruthy();
    expect(
      verifySelect.closest(".table-toolbar__verify")?.textContent,
    ).toContain("OFF");
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
    await openTableSettings();
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
        useAppStore.getState().workspace.sheets.find((s) => s.sheetId === first)
          ?.writeVerify,
      ).toEqual({ mode: "delayed", delayMs: 200 });
    });
    // 第二张表仍为默认 OFF。
    expect(
      useAppStore.getState().workspace.sheets.find((s) => s.sheetId === second)
        ?.writeVerify,
    ).toEqual({ mode: "off", delayMs: null });
  });
});

describe("RegisterTable 工具栏表级 Address Adjust（2026-09-01，ADR-042）", () => {
  function makeHostWithAdjust(): AppHost {
    const contributionRegistry = new ContributionPointRegistry();
    contributionRegistry.registerPoint({
      id: "addressTransform",
      schema: ADDRESS_TRANSFORM_CONTRIBUTION_SCHEMA,
    });
    const registry = new PluginRegistry({ contributionRegistry });
    registry.register(
      {
        id: "builtin-address-adjust",
        name: "Address Adjust",
        version: "1.0.0",
        apiVersion: "2.0",
        description: "Built-in table-level Address Adjust.",
        platform: { web: true, node: true },
        permissions: [],
        contributes: {
          addressTransform: {
            id: "builtin.address-adjust",
            protocol: "rtu",
            titleKey: "table.addressAdjust",
            defaultConfig: { enabled: false },
          },
        },
      },
      // 插件外部化：随应用分发插件以 installed 来源注册（可禁用/卸载）。
      { source: "installed" },
    );
    return {
      capabilities: {
        modbusRtu: true,
        modbusTcp: false,
        serialPorts: "browser-picker",
        filesystem: "limited",
        nodePlugins: false,
        webPlugins: true,
        logExport: "download",
        workspaceImport: "upload",
        workspaceExport: "download",
        pluginInstall: "upload",
        executablePlugins: false,
        hostPlugins: false,
        protocolExtensions: [],
        tableTypes: ["holding-register"],
      },
      pluginRegistry: registry,
      getCommProperties: () => ({
        protocol: "rtu",
        portLabel: null,
        unitId: null,
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
        timeoutMs: 1000,
        retryCount: 1,
        connectionState: "connected",
      }),
    } as unknown as AppHost;
  }

  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: makeHostWithAdjust(),
      workspace: createEmptyWorkspace(),
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  it("默认 OFF；切到 ON 更新本表 addressTransform（内置 builtin.address-adjust）", async () => {
    const sid = sheetId();
    expect(
      useAppStore.getState().workspace.sheets[0]?.addressTransform,
    ).toBeNull();
    render(<RegisterTable sheetId={sid} />);
    await openTableSettings();
    // 设置面板 label 文本（i18n table.addressAdjust）+ 相邻 Segmented（.table-toolbar__adjust）。
    const label = screen.getByText("Address Adjust");
    const adjustSegmented = label
      .closest(".table-toolbar__adjust")
      ?.querySelector(".ant-segmented");
    expect(adjustSegmented).toBeTruthy();
    // Segmented 点击「ON」。
    fireEvent.click(
      Array.from(
        adjustSegmented?.querySelectorAll(".ant-segmented-item") ?? [],
      ).find((el) => el.textContent === "ON") as HTMLElement,
    );
    await waitFor(() => {
      expect(
        useAppStore.getState().workspace.sheets[0]?.addressTransform,
      ).toEqual({ transformId: "builtin.address-adjust", enabled: true });
    });
  });

  it("切回 OFF 关闭本表调整", async () => {
    const sid = sheetId();
    useAppStore.getState().setSheetAddressTransform(sid, {
      transformId: "builtin.address-adjust",
      enabled: true,
    });
    render(<RegisterTable sheetId={sid} />);
    await openTableSettings();
    const label = screen.getByText("Address Adjust");
    const adjustSegmented = label
      .closest(".table-toolbar__adjust")
      ?.querySelector(".ant-segmented");
    fireEvent.click(
      Array.from(
        adjustSegmented?.querySelectorAll(".ant-segmented-item") ?? [],
      ).find((el) => el.textContent === "OFF") as HTMLElement,
    );
    await waitFor(() => {
      expect(
        useAppStore.getState().workspace.sheets[0]?.addressTransform,
      ).toBeNull();
    });
  });
});

describe("RegisterTable No 列宽度自适应（2026-08-27）", () => {
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

  /** No 列宽（colgroup 内 col index 1 的 inline width；列序默认时 index 0=选择列、1=No）。 */
  function noColumnWidth(): number | null {
    const col = document.querySelectorAll("table colgroup col")[1];
    const match = col?.getAttribute("style")?.match(/width:\s*(\d+)px/);
    return match !== undefined && match !== null ? Number(match[1]) : null;
  }

  /** 构造 maxOrder=order 的工作区（首行 order 改为指定值，其余保持 1。n）。 */
  function workspaceWithMaxOrder(order: number): Workspace {
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("missing sheet");
    const rows = sheet.rows.map((row, index) =>
      index === 0 ? { ...row, order } : row,
    );
    return { ...workspace, sheets: [{ ...sheet, rows }] };
  }

  it("默认 50 行（maxOrder=50，2 位）：No 列宽 = computeNoColumnWidth(50)", () => {
    render(<RegisterTable sheetId={sheetId()} />);
    expect(noColumnWidth()).toBe(computeNoColumnWidth(50));
  });

  it("范围行场景：No 单元格 = 行号 + antd 展开图标（加号）共存，td 带 nowrap 类", () => {
    // 构造范围行（registerCount=2）触发 antd 树形模式 → 首列注入展开图标
    // （「加号按钮」，折叠态即 +；无范围行的纯普通表不渲染该图标）。
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("missing sheet");
    const rows = sheet.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            registerCount: 2,
            registerValues: [{ value: 0 }, { value: 0 }],
          }
        : row,
    );
    useAppStore.setState({
      workspace: { ...workspace, sheets: [{ ...sheet, rows }] },
    });
    render(<RegisterTable sheetId={sheetId()} />);
    const firstRowTd = document.querySelector(
      ".ant-table-tbody tr.ant-table-row td:nth-child(2)",
    );
    expect(firstRowTd).toBeTruthy();
    // 行号（第一行 order=1）与 antd 树形展开图标（「加号按钮」）同格。
    expect(firstRowTd?.textContent?.trim()).toBe("1");
    expect(
      firstRowTd?.querySelector(".ant-table-row-expand-icon"),
    ).toBeTruthy();
    // nowrap 类（防换行），配合自适应宽度保证单行。
    expect(firstRowTd?.classList.contains("register-table__cell--no")).toBe(
      true,
    );
  });

  it("行号位数增长到 3 位：No 列宽随 maxOrder 增大（rerender 响应）", () => {
    const { rerender } = render(<RegisterTable sheetId={sheetId()} />);
    expect(noColumnWidth()).toBe(50);
    useAppStore.setState({ workspace: workspaceWithMaxOrder(1000) });
    rerender(<RegisterTable sheetId={sheetId()} />);
    expect(noColumnWidth()).toBe(computeNoColumnWidth(1000));
  });

  it("小表（maxOrder=3，1 位）：No 列宽回落到最小自适应值", () => {
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("missing sheet");
    useAppStore.setState({
      workspace: {
        ...workspace,
        sheets: [{ ...sheet, rows: sheet.rows.slice(0, 3) }],
      },
    });
    render(<RegisterTable sheetId={sheetId()} />);
    expect(noColumnWidth()).toBe(computeNoColumnWidth(3));
  });
});

describe("RegisterTable 范围行子行可编辑化（2026-08-27）", () => {
  beforeEach(() => {
    initI18n();
    // 构造范围行：首行 registerCount=2 + registers 元数据 + registerValues。
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("missing sheet");
    const rows = sheet.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            registerCount: 2,
            registerValues: [{ value: 0x12 }, { value: 0x34 }],
            cellText: "0012 0034",
            registers: [
              { name: "Hi", comment: "high", dataType: "hex" as const },
              { name: "Lo", comment: "low", dataType: "unsigned" as const },
            ],
          }
        : row,
    );
    useAppStore.setState({
      host: null,
      workspace: { ...workspace, sheets: [{ ...sheet, rows }] },
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  /** 展开首行（范围行）→ 子行渲染。 */
  function expandRangeRow(): void {
    const expandIcon = document.querySelector(".ant-table-row-expand-icon");
    if (expandIcon === null) throw new Error("missing expand icon");
    fireEvent.click(expandIcon);
    // 展开后 2 个子行出现（各列 aria-label 数量 +2）。
    expect(screen.getAllByLabelText("Data").length).toBeGreaterThanOrEqual(3);
  }

  it("子行 Name 可编辑并写回父行 registers[0].name", async () => {
    render(<RegisterTable sheetId={sheetId()} />);
    expandRangeRow();
    // Name 单元格：父行 1 + 子行 2；子行第一个是 index 1。
    const cells = screen.getAllByLabelText("Name");
    expect(cells.length).toBeGreaterThanOrEqual(3);
    const childName = cells[1];
    if (childName === undefined) throw new Error("missing child name cell");
    expect(childName.textContent).toBe("Hi");
    fireEvent.click(childName);
    const input = screen.getAllByLabelText("Name")[1];
    if (input === undefined) throw new Error("missing child name input");
    fireEvent.change(input, { target: { value: "H1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        useAppStore.getState().workspace.sheets[0]?.rows[0]?.registers?.[0]
          ?.name,
      ).toBe("H1");
    });
  });

  it("子行 Data 可编辑并同步父行 registerValues 与组合文本", async () => {
    render(<RegisterTable sheetId={sheetId()} />);
    expandRangeRow();
    // 子行 0 显示自身 Type（hex）格式化的值 "0012"。
    const cells = screen.getAllByLabelText("Data");
    expect(cells.length).toBeGreaterThanOrEqual(3);
    const childData = cells[1];
    if (childData === undefined) throw new Error("missing child data cell");
    fireEvent.click(childData);
    const input = screen.getAllByLabelText("Data")[1];
    if (input === undefined) throw new Error("missing child data input");
    fireEvent.change(input, { target: { value: "AB" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
      expect(row?.registerValues?.map((v) => v.value)).toEqual([0xab, 0x34]);
      expect(row?.cellText).toBe("00AB 0034");
    });
  });

  it("子行 Comment 可编辑并写回父行 registers[1].comment", async () => {
    render(<RegisterTable sheetId={sheetId()} />);
    expandRangeRow();
    const cells = screen.getAllByLabelText("Comment");
    expect(cells.length).toBeGreaterThanOrEqual(3);
    const childComment = cells[2];
    if (childComment === undefined) throw new Error("missing child comment");
    expect(childComment.textContent).toBe("low");
    fireEvent.click(childComment);
    const input = screen.getAllByLabelText("Comment")[2];
    if (input === undefined) throw new Error("missing child comment input");
    fireEvent.change(input, { target: { value: "L2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        useAppStore.getState().workspace.sheets[0]?.rows[0]?.registers?.[1]
          ?.comment,
      ).toBe("L2");
    });
  });
});

describe("RegisterTable 位明细展开（ADR-052，2026-09-11）", () => {
  function setupBinaryRow(
    options: {
      sheetType?: string;
      /** 覆盖父行原始值（传 null 模拟「未读取」）；省略时用 0x8001。 */
      registerValues?: { value: number }[] | null;
    } = {},
  ): void {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("missing sheet");
    const values =
      "registerValues" in options
        ? options.registerValues
        : [{ value: 0x8001 }];
    const rows = sheet.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            dataType: "binary" as const,
            registerValues: values,
            cellText: values === null ? "" : "10000000 00000001",
            bitComments: [
              Array.from({ length: 16 }, (_, bit) =>
                bit === 15 ? "alarm" : "",
              ),
            ],
            bitNames: [
              Array.from({ length: 16 }, (_, bit) =>
                bit === 15 ? "Alarm bit" : "",
              ),
            ],
          }
        : row,
    );
    useAppStore.setState({
      host: null,
      workspace: {
        ...workspace,
        sheets: [{ ...sheet, type: options.sheetType ?? sheet.type, rows }],
      },
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
      undoStack: [],
      redoStack: [],
    });
  }

  function expandBitRow(): void {
    const expandIcon = document.querySelector(".ant-table-row-expand-icon");
    if (expandIcon === null) throw new Error("missing expand icon");
    fireEvent.click(expandIcon);
  }

  it("Address 列按「寄存器地址 + Bit 序号」渲染（bit15 → bit0），掩码作为 hover 提示", () => {
    setupBinaryRow();
    render(<RegisterTable sheetId={sheetId()} />);
    expandBitRow();
    // 默认表 radix=dec（defaultConfig.registerTable.addressRadix），空地址即 0。
    const bit15 = screen.getByText("0 Bit 15");
    expect(bit15.getAttribute("title")).toBe("0x8000");
    const bit0 = screen.getByText("0 Bit 0");
    expect(bit0.getAttribute("title")).toBe("0x0001");
  });

  it("位行 Name 可编辑并写回父行 bitNames（入撤销栈）", async () => {
    setupBinaryRow();
    render(<RegisterTable sheetId={sheetId()} />);
    expandBitRow();
    // Name 单元格顺序：父行 1 + 位行 16（bit15 在前）。
    const cells = screen.getAllByLabelText("Name");
    const bitName = cells[1];
    if (bitName === undefined) throw new Error("missing bit name cell");
    fireEvent.click(bitName);
    const input = screen.getAllByLabelText("Name")[1];
    if (input === undefined) throw new Error("missing bit name input");
    fireEvent.change(input, { target: { value: "Alarm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        useAppStore.getState().workspace.sheets[0]?.rows[0]
          ?.bitNames?.[0]?.[15],
      ).toBe("Alarm");
      expect(useAppStore.getState().undoStack).toHaveLength(1);
    });
  });

  it("位行 Data 只提供开关（1/0），不提供输入框", () => {
    setupBinaryRow();
    render(<RegisterTable sheetId={sheetId()} />);
    expandBitRow();
    // 16 行位明细各一个开关；位行内不存在输入框（交互简化）。
    expect(document.querySelectorAll(".register-table__bit-value").length).toBe(
      16,
    );
    expect(
      document.querySelectorAll(".register-table__bit-value input").length,
    ).toBe(0);
    expect(
      screen.getAllByLabelText(/^Toggle bit \d+, row \d+, address /),
    ).toHaveLength(16);
    // 开关自带 1/0 文字（checkedChildren / unCheckedChildren）。
    const bit15 = screen.getByLabelText(/^Toggle bit 15, row \d+, address /);
    expect(bit15.querySelector(".ant-switch-inner-checked")?.textContent).toBe(
      "1",
    );
    expect(
      bit15.querySelector(".ant-switch-inner-unchecked")?.textContent,
    ).toBe("0");
    // 开关状态与位值一致（0x8001：bit15 = 1、bit14 = 0）。
    expect(bit15.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByLabelText(/^Toggle bit 14, row \d+, address /)
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("未读取时开关内显示 —（替代 0）且仍可切换（按全 0 基准）", () => {
    setupBinaryRow({ registerValues: null });
    render(<RegisterTable sheetId={sheetId()} />);
    expandBitRow();
    // 未读取：未选中侧文字为 —（不再是 0），且不再使用开关外侧占位。
    const bit0 = screen.getByLabelText(/^Toggle bit 0, row \d+, address /);
    expect(bit0.getAttribute("aria-checked")).toBe("false");
    expect(bit0.querySelector(".ant-switch-inner-unchecked")?.textContent).toBe(
      "—",
    );
    expect(
      document.querySelectorAll(".register-table__bit-value-placeholder")
        .length,
    ).toBe(0);
    fireEvent.click(bit0);
    const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
    expect(row?.registerValues?.map((v) => v.value)).toEqual([0x0001]);
    expect(row?.cellText).toBe("00000000 00000001");
    // 已有当前值：未选中侧恢复为 0（该位此时为 1 → 显示在选中侧）。
    const after = screen.getByLabelText(/^Toggle bit 0, row \d+, address /);
    expect(after.getAttribute("aria-checked")).toBe("true");
    expect(after.querySelector(".ant-switch-inner-checked")?.textContent).toBe(
      "1",
    );
    expect(
      after.querySelector(".ant-switch-inner-unchecked")?.textContent,
    ).toBe("0");
  });

  it("点击切换控件改位值并同步父行当前值（不入撤销栈、不进入编辑态）", () => {
    setupBinaryRow();
    render(<RegisterTable sheetId={sheetId()} />);
    expandBitRow();
    const toggle = screen.getAllByLabelText(
      /^Toggle bit 0, row \d+, address /,
    )[0];
    if (toggle === undefined) throw new Error("missing toggle");
    fireEvent.click(toggle);
    const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
    expect(row?.registerValues?.[0]?.value).toBe(0x8000);
    expect(row?.cellText).toBe("10000000 00000000");
    // 位值=当前值变更：不入撤销栈；位行 Data 不进入编辑态（只有开关、无输入框）。
    expect(useAppStore.getState().undoStack).toHaveLength(0);
    expect(
      document.querySelectorAll(".register-table__bit-value input").length,
    ).toBe(0);
  });

  it("位注释可编辑并写回父行 bitComments（入撤销栈）", async () => {
    setupBinaryRow();
    render(<RegisterTable sheetId={sheetId()} />);
    expandBitRow();
    // 位行按 bit15 → bit0 渲染；第 1 个 Comment 单元格是父行，第 2 个是 bit15。
    const cells = screen.getAllByLabelText("Comment");
    const bitComment = cells[1];
    if (bitComment === undefined) throw new Error("missing bit comment cell");
    expect(bitComment.textContent).toBe("alarm");
    fireEvent.click(bitComment);
    const input = screen.getAllByLabelText("Comment")[1];
    if (input === undefined) throw new Error("missing bit comment input");
    fireEvent.change(input, { target: { value: "warning" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        useAppStore.getState().workspace.sheets[0]?.rows[0]
          ?.bitComments?.[0]?.[15],
      ).toBe("warning");
      expect(useAppStore.getState().undoStack).toHaveLength(1);
    });
  });

  it("范围行寄存器子行展开后切换位值 → 同步父行组合文本（两层嵌套）", () => {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("missing sheet");
    const rows = sheet.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            registerCount: 2,
            dataType: "binary" as const,
            registerValues: [{ value: 0x8001 }, { value: 0x0002 }],
            cellText: "10000000 00000001 00000000 00000010",
          }
        : row,
    );
    useAppStore.setState({
      host: null,
      workspace: { ...workspace, sheets: [{ ...sheet, rows }] },
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
      undoStack: [],
      redoStack: [],
    });
    render(<RegisterTable sheetId={sheetId()} />);

    // 第一层：展开范围行 → 2 个寄存器子行。
    expandBitRow();
    const childExpandIcons = document.querySelectorAll(
      ".ant-table-row-expand-icon",
    );
    const childIcon = childExpandIcons[1];
    if (childIcon === undefined) throw new Error("missing child expand icon");
    fireEvent.click(childIcon);

    // 第二层：寄存器 0 的 bit15（当前为 1）切为 0。
    const toggle = screen.getAllByLabelText(
      /^Toggle bit 15, row \d+, address /,
    )[0];
    if (toggle === undefined) throw new Error("missing toggle");
    fireEvent.click(toggle);
    const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
    expect(row?.registerValues?.map((v) => v.value)).toEqual([0x0001, 0x0002]);
    expect(row?.cellText).toBe("00000000 00000001 00000000 00000010");
  });

  it("只读表（input-register）可展开位明细但切换与 Name/注释编辑禁用", () => {
    setupBinaryRow({ sheetType: "input-register" });
    render(<RegisterTable sheetId={sheetId()} />);
    expandBitRow();
    expect(screen.getByText("0 Bit 15")).toBeDefined();
    const toggle = screen.getAllByLabelText(
      /^Toggle bit 15, row \d+, address /,
    )[0];
    if (toggle === undefined) throw new Error("missing toggle");
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    // 只读表同样只有开关、无输入框。
    expect(
      document.querySelectorAll(".register-table__bit-value input").length,
    ).toBe(0);
    // 只读：Name/Comment 单元格不进入编辑（无 role=button）。
    const bitComment = screen.getAllByLabelText("Comment")[1];
    expect(bitComment?.getAttribute("role")).toBeNull();
    const bitName = screen.getAllByLabelText("Name")[1];
    expect(bitName?.getAttribute("role")).toBeNull();
  });
});

describe("RegisterTable Read All 全局 message（2026-08-28）", () => {
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

  function fakeHostWithSummary(summary: BatchReadSummary): AppHost {
    return {
      readAllRows: vi.fn(
        (): BatchReadHandle =>
          ({
            promise: Promise.resolve(ok(summary)),
            cancel: vi.fn(),
          }) as BatchReadHandle,
      ),
      // 工具栏「从站地址 / Unit ID」label 需读活动协议。
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
        connectionState: "connected",
      })),
    } as unknown as AppHost;
  }

  function baseSummary(): BatchReadSummary {
    return {
      batchId: "b-1",
      totalRows: 8,
      eligibleRows: 8,
      successCount: 8,
      failureCount: 0,
      skippedCount: 0,
      cancelledCount: 0,
      startedAt: 0,
      completedAt: 152,
      durationMs: 152,
    };
  }

  it("Read All 成功后弹出富内容全局 message（统计 + 耗时），底部消息照常追加", async () => {
    useAppStore.setState({ host: fakeHostWithSummary(baseSummary()) });
    render(
      <AntApp>
        <RegisterTable sheetId={sheetId()} />
      </AntApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read All/ }));
    // 全局 message 渲染到 body（AntApp holder），内容为富内容组件。
    await waitFor(() => {
      expect(document.querySelector(".read-all-result")).toBeTruthy();
    });
    const root = document.querySelector(".read-all-result");
    expect(root?.textContent).toContain("Read All Complete");
    expect(root?.textContent).toContain("8 Succeeded");
    expect(root?.textContent).toContain("152 ms");
    // 底部面板消息照常追加（既有行为不回归）。
    await waitFor(() => {
      const messages = useAppStore.getState().messages;
      expect(messages.at(-1)?.messageKey).toBe("table.batchSummary");
    });
  });

  it("有失败时全局 message 标题为警示图标，失败 Tag 带 error 语义色", async () => {
    useAppStore.setState({
      host: fakeHostWithSummary({
        ...baseSummary(),
        successCount: 6,
        failureCount: 2,
      }),
    });
    render(
      <AntApp>
        <RegisterTable sheetId={sheetId()} />
      </AntApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read All/ }));
    await waitFor(() => {
      expect(document.querySelector(".read-all-result")).toBeTruthy();
    });
    // （antd 图标 class 用 icon.name：ExclamationCircleFilled → anticon-exclamation-circle）
    expect(document.querySelector(".anticon-exclamation-circle")).toBeTruthy();
    expect(
      document.querySelector(".read-all-result .ant-tag-error"),
    ).toBeTruthy();
  });
});

describe("RegisterTable 键盘快捷键（PRD §8.3 P1，2026-08-30）", () => {
  beforeEach(() => {
    initI18n();
    // 小工作区（jsdom 渲染 50 行过慢易超时）：仅保留首表前 3 行。
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) sheet.rows = sheet.rows.slice(0, 3);
    useAppStore.setState({
      host: null,
      workspace,
      // 重置活动表：避免本文件其他用例把 activeSheetId 设成非空值后污染活动表守卫
      // （handleGlobalKeyDown 只响应活动表）。
      activeSheetId: null,
      connectionState: "connected",
      selectedRowIds: [],
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
      connectionModalOpen: false,
      settingsModalOpen: false,
      helpModalOpen: false,
      workspaceImportDraft: null,
      pendingDeleteSheetId: null,
      pendingBulkClose: null,
    });
  });

  function makeHost(overrides: Partial<AppHost> = {}): AppHost {
    return {
      readAllRows: vi.fn(
        (): BatchReadHandle =>
          ({
            promise: new Promise<Result<BatchReadSummary>>(() => {}),
            cancel: vi.fn(),
          }) as BatchReadHandle,
      ),
      readRow: vi.fn(async (): Promise<Result<number | number[]>> => ok(42)),
      writeRow: vi.fn(async (): Promise<Result<WriteOutcome>> =>
        ok({ kind: "write-succeeded-no-verify" } as WriteOutcome),
      ),
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
        connectionState: "connected",
      })),
      ...overrides,
    } as unknown as AppHost;
  }

  function rowIdAt(index: number): RowId {
    const row = useAppStore.getState().workspace.sheets[0]?.rows[index];
    if (row === undefined) throw new Error(`missing row ${index}`);
    return row.rowId;
  }

  function fireKeyOn(
    target: Element | Document | Window,
    key: string,
    mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
  ): void {
    fireEvent.keyDown(target, {
      key,
      ctrlKey: mods.ctrl ?? false,
      metaKey: false,
      shiftKey: mods.shift ?? false,
      altKey: mods.alt ?? false,
    });
  }

  it("F9 触发全表读取（Read All），运行中再按 F9 取消", async () => {
    const readAllRows = vi.fn(
      (): BatchReadHandle =>
        ({
          promise: new Promise<Result<BatchReadSummary>>(() => {}),
          cancel: vi.fn(),
        }) as BatchReadHandle,
    );
    useAppStore.setState({ host: makeHost({ readAllRows }) });
    render(
      <AntApp>
        <RegisterTable sheetId={sheetId()} />
      </AntApp>,
    );

    fireKeyOn(window, "F9");
    expect(readAllRows).toHaveBeenCalledTimes(1);
    expect(readAllRows).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ unitAddress: 1, protocol: "rtu" }),
    );
    // 运行态：取消按钮出现；再按 F9 = 取消（handle.cancel）。
    const cancel = screen.getByRole("button", { name: /Cancel/ });
    fireKeyOn(window, "F9");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
    });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
  });

  it("F8 读取选中行（readRow 被调用，Data 值更新为回读值）", async () => {
    const readRow = vi.fn(async (): Promise<Result<number | number[]>> =>
      ok(42),
    );
    useAppStore.setState({
      host: makeHost({ readRow }),
      selectedRowIds: [rowIdAt(0)],
    });
    render(<RegisterTable sheetId={sheetId()} />);

    fireKeyOn(window, "F8");
    await waitFor(() => {
      expect(readRow).toHaveBeenCalledTimes(1);
    });
    expect(readRow).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ unitAddress: 1, protocol: "rtu" }),
    );
    await waitFor(() => {
      const row = useAppStore
        .getState()
        .workspace.sheets[0]?.rows.find((r) => r.rowId === rowIdAt(0));
      // 默认行 dataType 为 HEX：42 → "002A"。
      expect(row?.cellText).toBe("002A");
    });
  });

  it("Ctrl+Shift+Enter 写入选中行（writeRow 被调用）", async () => {
    const writeRow = vi.fn(async (): Promise<Result<WriteOutcome>> =>
      ok({ kind: "write-succeeded-no-verify" } as WriteOutcome),
    );
    useAppStore.setState({
      host: makeHost({ writeRow }),
      selectedRowIds: [rowIdAt(0)],
    });
    render(<RegisterTable sheetId={sheetId()} />);

    fireKeyOn(window, "Enter", { ctrl: true, shift: true });
    await waitFor(() => {
      expect(writeRow).toHaveBeenCalledTimes(1);
    });
    expect(writeRow).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ unitAddress: 1, protocol: "rtu" }),
    );
  });

  it("Alt+P 切换选中行的轮询（WP）开关", () => {
    useAppStore.setState({ host: makeHost(), selectedRowIds: [rowIdAt(0)] });
    render(<RegisterTable sheetId={sheetId()} />);
    const before = useAppStore
      .getState()
      .workspace.sheets[0]?.rows.find(
        (r) => r.rowId === rowIdAt(0),
      )?.pollingEnabled;

    fireKeyOn(window, "p", { alt: true });
    const after = useAppStore
      .getState()
      .workspace.sheets[0]?.rows.find(
        (r) => r.rowId === rowIdAt(0),
      )?.pollingEnabled;
    expect(after).toBe(!before);
  });

  it("↑/↓ 移动选中行（焦点在表格体内，替换单选）", () => {
    useAppStore.setState({
      host: makeHost(),
      selectedRowIds: [rowIdAt(1)],
    });
    render(<RegisterTable sheetId={sheetId()} />);
    const table = document.querySelector(".ant-table");
    expect(table).toBeTruthy();

    fireKeyOn(table!, "ArrowDown");
    expect(useAppStore.getState().selectedRowIds).toEqual([rowIdAt(2)]);
    fireKeyOn(table!, "ArrowUp");
    expect(useAppStore.getState().selectedRowIds).toEqual([rowIdAt(1)]);
  });

  it("Ctrl+Alt+R 恢复列布局（清列宽与列序）", () => {
    const st = useAppStore.getState();
    st.setSheetColumnWidths(sheetId(), { no: 60 });
    st.setSheetColumnOrder(sheetId(), ["no", "tm"]);
    useAppStore.setState({ host: makeHost() });
    render(<RegisterTable sheetId={sheetId()} />);

    fireKeyOn(window, "r", { ctrl: true, alt: true });
    const sheet = useAppStore
      .getState()
      .workspace.sheets.find((s) => s.sheetId === sheetId());
    expect(sheet?.columnWidths).toEqual({});
    expect(sheet?.columnOrder).toBeNull();
  });

  it("弹窗打开时表格级快捷键被抑制（F8 不读取）", () => {
    const readRow = vi.fn(async (): Promise<Result<number | number[]>> =>
      ok(42),
    );
    useAppStore.setState({
      host: makeHost({ readRow }),
      selectedRowIds: [rowIdAt(0)],
      settingsModalOpen: true,
    });
    render(<RegisterTable sheetId={sheetId()} />);

    fireKeyOn(window, "F8");
    expect(readRow).not.toHaveBeenCalled();
  });
});

describe("RegisterTable 基础表（ADR-043 E-2）", () => {
  function withSheetType(type: string): void {
    const workspace = useAppStore.getState().workspace;
    const sheets = workspace.sheets.map((sheet, index) =>
      index === 0 ? { ...sheet, type } : sheet,
    );
    useAppStore.setState({ workspace: { ...workspace, sheets } });
  }

  it("离散输入表（只读）：Write 按钮禁用并显示只读提示", () => {
    initI18n();
    withSheetType("discrete-input");
    useAppStore.setState({
      host: null,
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
    render(<RegisterTable sheetId={sheetId()} />);
    const writeButtons = screen.getAllByRole("button", {
      name: /^Write row /,
    });
    expect(writeButtons.length).toBeGreaterThan(0);
    for (const button of writeButtons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("线圈表（可读写）：Write 按钮可用（connected + 合法地址）", () => {
    initI18n();
    withSheetType("coil");
    const workspace = useAppStore.getState().workspace;
    const firstSheet = workspace.sheets[0];
    const address = RegisterAddress.create(0);
    const rows = (firstSheet?.rows ?? []).map((row, index) =>
      index === 0
        ? {
            ...row,
            addressDraft: "0",
            addressValue: address.ok ? address.value : null,
          }
        : row,
    );
    const sheets = workspace.sheets.map((sheet, index) =>
      index === 0 ? { ...sheet, rows } : sheet,
    );
    useAppStore.setState({
      workspace: { ...workspace, sheets },
      host: null,
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
    render(<RegisterTable sheetId={sheetId()} />);
    const writeButtons = screen.getAllByRole("button", {
      name: /^Write row /,
    });
    expect(writeButtons.length).toBeGreaterThan(0);
    // 首行有合法地址：按钮可用。
    expect((writeButtons[0] as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("RegisterTable 行操作视觉权重", () => {
  beforeEach(() => {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) sheet.rows = sheet.rows.slice(0, 3);
    useAppStore.setState({
      host: null,
      workspace,
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  });

  it("行级 READ/WRITE 使用默认描边按钮并保留完整文字，Read All 保持主按钮", () => {
    render(<RegisterTable sheetId={sheetId()} />);

    const rowActions = [
      ...screen.getAllByRole("button", { name: /^Read row / }),
      ...screen.getAllByRole("button", { name: /^Write row / }),
    ];
    expect(rowActions.length).toBeGreaterThan(0);
    for (const action of rowActions) {
      expect(action.classList.contains("ant-btn-primary")).toBe(false);
      expect(action.classList.contains("register-table__row-action")).toBe(
        true,
      );
      expect(action.textContent?.trim()).toMatch(/^(Read|Write)$/);
    }

    expect(
      screen
        .getByRole("button", { name: /Read All/ })
        .classList.contains("ant-btn-primary"),
    ).toBe(true);
  });
});

describe("RegisterTable WP 轮询状态", () => {
  beforeEach(() => {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) {
      sheet.rows = sheet.rows.slice(0, 3);
      const first = sheet.rows[0];
      const address = RegisterAddress.create(0);
      if (first !== undefined && address.ok) {
        sheet.rows[0] = {
          ...first,
          addressDraft: "0",
          addressValue: address.value,
          pollingEnabled: true,
        };
      }
    }
    useAppStore.setState({
      host: null,
      workspace,
      connectionState: "connected",
      pollingOutcomes: {},
      rowResults: {},
    });
  });

  it("关闭、等待、成功、失败使用不同视觉状态，并由辅助文本读出", async () => {
    const first = useAppStore.getState().workspace.sheets[0]?.rows[0];
    if (first === undefined) throw new Error("missing first row");
    const { container } = render(<RegisterTable sheetId={sheetId()} />);
    const wp = container.querySelector<HTMLElement>(".register-table__wp");
    if (wp === null) throw new Error("missing WP cell");

    expect(wp.dataset.pollingState).toBe("waiting");
    expect(
      wp.querySelector(".register-table__wp-indicator--waiting"),
    ).toBeTruthy();
    const wpSwitch = wp.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(wpSwitch).not.toBeNull();
    expect(
      document.getElementById(wpSwitch?.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Polling on, waiting for response");

    useAppStore.setState({
      pollingOutcomes: { [first.rowId]: "success" },
    });
    await waitFor(() => {
      expect(wp.dataset.pollingState).toBe("success");
    });
    expect(
      wp.querySelector(".register-table__wp-indicator--success"),
    ).toBeTruthy();

    useAppStore.setState({
      pollingOutcomes: { [first.rowId]: "failure" },
      rowResults: {
        [first.rowId]: {
          messageKey: "errors.requestTimeout",
          detail: null,
        },
      },
    });
    await waitFor(() => {
      expect(wp.dataset.pollingState).toBe("failure");
    });
    expect(
      wp.querySelector(".register-table__wp-indicator--failure"),
    ).toBeTruthy();
    expect(
      document.getElementById(wpSwitch?.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Polling failed: No response from the device within the timeout.");

    useAppStore.getState().setPollingEnabled(first.rowId, false);
    await waitFor(() => {
      expect(wp.dataset.pollingState).toBe("off");
    });
    expect(wp.querySelector(".register-table__wp-indicator")).toBeNull();
    expect(
      document.getElementById(wpSwitch?.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Polling off");
  }, 30_000);
});

describe("RegisterTable 离线通信操作门控", () => {
  const offlineStates: ConnectionState[] = [
    "disconnected",
    "failed",
    "interrupted",
  ];

  it("三种离线态统一禁用通信入口、快捷键不发起请求，恢复连接后自动解锁", async () => {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) {
      sheet.rows = sheet.rows.slice(0, 1).map((row, index) => {
        const address = RegisterAddress.create(index);
        return {
          ...row,
          addressDraft: String(index),
          addressValue: address.ok ? address.value : null,
        };
      });
    }
    const readAllRows = vi.fn(
      (): BatchReadHandle =>
        ({
          promise: new Promise<Result<BatchReadSummary>>(() => {}),
          cancel: vi.fn(),
        }) as BatchReadHandle,
    );
    const readRow = vi.fn(async (): Promise<Result<number | number[]>> =>
      ok(42),
    );
    const writeRow = vi.fn(async (): Promise<Result<WriteOutcome>> =>
      ok({ kind: "write-succeeded-no-verify" } as WriteOutcome),
    );
    const host = {
      readAllRows,
      readRow,
      writeRow,
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
        connectionState: "connected",
      })),
    } as unknown as AppHost;
    const selectedRowId = workspace.sheets[0]?.rows[0]?.rowId;
    useAppStore.setState({
      host,
      workspace,
      activeSheetId: null,
      connectionState: "disconnected",
      connectionModalOpen: false,
      selectedRowIds: selectedRowId === undefined ? [] : [selectedRowId],
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
    render(
      <AntApp>
        <RegisterTable sheetId={sheetId()} />
      </AntApp>,
    );

    for (const state of offlineStates) {
      readAllRows.mockClear();
      readRow.mockClear();
      writeRow.mockClear();
      useAppStore.setState({
        connectionState: state,
        connectionModalOpen: false,
      });
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Connect device/ }),
        ).toBeTruthy();
      });

      expect(screen.queryByRole("button", { name: /Read All/ })).toBeNull();
      const connectButton = screen.getByRole("button", {
        name: /Connect device/,
      });
      fireEvent.click(connectButton);
      expect(useAppStore.getState().connectionModalOpen).toBe(true);
      useAppStore.setState({ connectionModalOpen: false });

      const communicationControls = [
        ...screen.getAllByRole("button", { name: /^Read row / }),
        ...screen.getAllByRole("button", { name: /^Write row / }),
        ...screen.getAllByRole("switch", { name: /^Poll row / }),
      ];
      expect(communicationControls.length).toBeGreaterThan(0);
      const descriptions = new Set<string>();
      for (const control of communicationControls) {
        expect((control as HTMLButtonElement).disabled).toBe(true);
        const describedBy = control.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        const description = document.getElementById(describedBy ?? "");
        expect(description?.textContent).toBe(
          "Connect the device before reading, writing, or polling.",
        );
        descriptions.add(description?.textContent ?? "");
      }
      expect(descriptions.size).toBe(1);

      fireEvent.click(
        screen.getAllByRole("button", { name: /^Read row / })[0]!,
      );
      fireEvent.click(
        screen.getAllByRole("button", { name: /^Write row / })[0]!,
      );
      fireEvent.keyDown(window, { key: "F9" });
      fireEvent.keyDown(window, { key: "F8" });
      fireEvent.keyDown(window, {
        key: "Enter",
        ctrlKey: true,
        shiftKey: true,
      });
      fireEvent.keyDown(window, { key: "p", altKey: true });
      expect(readAllRows).not.toHaveBeenCalled();
      expect(readRow).not.toHaveBeenCalled();
      expect(writeRow).not.toHaveBeenCalled();
    }

    useAppStore.setState({ connectionState: "connected" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Read All/ })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Connect device/ })).toBeNull();
    for (const control of [
      ...screen.getAllByRole("button", { name: /^Read row / }),
      ...screen.getAllByRole("button", { name: /^Write row / }),
    ]) {
      expect((control as HTMLButtonElement).disabled).toBe(false);
      expect(control.getAttribute("aria-describedby")).toBeNull();
    }
    for (const control of screen.getAllByRole("switch", {
      name: /^Poll row /,
    })) {
      expect((control as HTMLButtonElement).disabled).toBe(false);
      expect(
        document.getElementById(control.getAttribute("aria-describedby") ?? "")
          ?.textContent,
      ).toBe("Polling off");
    }
  }, 30_000);
});
