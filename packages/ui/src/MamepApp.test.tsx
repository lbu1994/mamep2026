/**
 * MamepApp Sheet 名重命名编辑态隔离测试（jsdom）。
 * 覆盖：
 * - 页签头进入编辑态时，侧边栏对应项不渲染输入框
 * - 页签头提交（Enter / 失焦）后名称在两处同步更新
 * - Escape 取消、失焦提交行为
 * - 输入框内按 Backspace 不冒泡到 Tabs 键盘删除逻辑（不关闭标签、不退出编辑态）
 * 编辑态为组件局部状态（非全局 store），相关 store 测试见 app-store.test.ts。
 * 侧边栏重命名入口仅为右键菜单 Rename（侧边栏双击进入更名已于移除）；
 * 右键菜单（Dropdown 弹层）在 jsdom 无法渲染弹层，其交互与提交/同步行为由 Playwright
 * e2e（tests/e2e-web/tests/sidebar-menu.spec.ts）覆盖。本文件保留页签头（双击）用例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { buildTheme, mergeThemeConfig } from "@mamep2026/ui-theme";
import { initI18n } from "./i18n";
import { useAppStore } from "./app-store";
import { MamepApp } from "./MamepApp";
import type { AppHost } from "./host";
import { makeHost } from "./test/make-app-host";

function tabRenameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    ".register-table-tabs .sheet-tab__input",
  );
}

function sidebarRenameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    ".sheet-sidebar__list .sheet-item__input",
  );
}

function tabLabel(): HTMLElement | null {
  return document.querySelector(".register-table-tabs .sheet-tab__label");
}

function tabLabelText(): string {
  return tabLabel()?.textContent ?? "";
}

/** 按名称查找侧边栏表项的名称 span（名称 = textContent）。 */
function sidebarItemName(name: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>(
        ".sheet-sidebar__list .sheet-item__name",
      ),
    ).find((el) => el.textContent === name) ?? null
  );
}

beforeEach(() => {
  initI18n();
  useAppStore.setState({
    host: null,
    workspace: createEmptyWorkspace(),
    loaded: true,
    // 启动骨架默认不显示（真实启动由 apps/web main.tsx 在渲染前置 "assembling"）。
    hostStatus: "ready",
    connectionState: "disconnected",
    activeSheetId: null,
  });
});

it("syncs the session address only after the active sheet value changes", async () => {
  const { host } = makeHost();
  const workspace = createEmptyWorkspace();
  const sheetId = workspace.sheets[0]?.sheetId;
  if (sheetId === undefined) throw new Error("missing active sheet");
  useAppStore.setState({ host, workspace });
  render(<MamepApp />);
  await waitFor(() => expect(host.setSlaveAddress).toHaveBeenCalledWith(1));
  vi.mocked(host.setSlaveAddress).mockClear();

  act(() => {
    useAppStore.getState().setSheetSlaveAddress(sheetId, 255);
  });
  await waitFor(() =>
    expect(host.setSlaveAddress).toHaveBeenCalledExactlyOnceWith(255),
  );

  act(() => {
    useAppStore.getState().setSheetSlaveAddress(sheetId, 255);
  });
  expect(host.setSlaveAddress).toHaveBeenCalledTimes(1);
});

describe("Sheet 名重命名编辑态隔离", () => {
  it("页签头进入编辑态时，侧边栏对应项不渲染输入框", () => {
    render(<MamepApp />);
    expect(tabLabelText()).toBe("Sheet 1");

    fireEvent.doubleClick(tabLabel()!);

    expect(tabRenameInput()).toBeTruthy();
    expect(sidebarRenameInput()).toBeNull();
    // 侧边栏仍显示普通名称。
    expect(sidebarItemName("Sheet 1")).toBeTruthy();
  });

  // 复现测试（Bug：页签重命名输入框焦点未落位）。
  // userEvent.dblClick 触发完整的鼠标序列（mousedown 会聚焦 .ant-tabs-tab-btn），
  // 输入框挂载后焦点应落在输入框内，而不是停留在 tab button。
  it("页签头双击进入编辑态后，焦点落在重命名输入框内", async () => {
    const user = userEvent.setup();
    render(<MamepApp />);

    await user.dblClick(tabLabel()!);

    const input = tabRenameInput();
    expect(input).toBeTruthy();
    // 编辑态下焦点应在输入框内（当前 bug：focus 停留并回流到 .ant-tabs-tab-btn）。
    expect(document.activeElement).toBe(input);
  });

  it("页签头 Enter 提交后，名称在页签头与侧边栏同步更新", () => {
    render(<MamepApp />);

    fireEvent.doubleClick(tabLabel()!);
    const input = tabRenameInput()!;
    fireEvent.change(input, { target: { value: "Inverter A" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(tabRenameInput()).toBeNull();
    expect(tabLabelText()).toBe("Inverter A");
    expect(sidebarItemName("Inverter A")).toBeTruthy();
    expect(sidebarItemName("Sheet 1")).toBeNull();
  });

  it("页签头失焦提交重命名并同步到侧边栏", () => {
    render(<MamepApp />);

    fireEvent.doubleClick(tabLabel()!);
    const input = tabRenameInput()!;
    fireEvent.change(input, { target: { value: "After Blur" } });
    fireEvent.blur(input);

    expect(tabRenameInput()).toBeNull();
    expect(tabLabelText()).toBe("After Blur");
    expect(sidebarItemName("After Blur")).toBeTruthy();
  });

  it("页签头 Escape 取消编辑且不改变名称", () => {
    render(<MamepApp />);

    fireEvent.doubleClick(tabLabel()!);
    const input = tabRenameInput()!;
    fireEvent.change(input, { target: { value: "Not Applied" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(tabRenameInput()).toBeNull();
    expect(tabLabelText()).toBe("Sheet 1");
    expect(sidebarItemName("Not Applied")).toBeNull();
  });

  it("页签头输入框按 Backspace：不关闭标签、不退出编辑态", () => {
    render(<MamepApp />);

    fireEvent.doubleClick(tabLabel()!);
    const input = tabRenameInput()!;
    // 聚焦输入框后按 Backspace（携带 code，模拟真实键盘事件）。
    input.focus();
    fireEvent.keyDown(input, { key: "Backspace", code: "Backspace" });

    // 编辑态仍在，且未因冒泡到 Tabs 键盘删除逻辑而关闭标签。
    expect(tabRenameInput()).toBeTruthy();
    expect(
      document.querySelectorAll(".sheet-sidebar__list .sheet-item--closed")
        .length,
    ).toBe(0);
    expect(sidebarItemName("Sheet 1")).toBeTruthy();
  });
});

describe("平台生命周期能力门控", () => {
  it("keepAwake=false 时不调用可选 KeepAwake 桥", () => {
    const setKeepScreenOn = vi.fn();
    const { host } = makeHost({ keepAwake: false }, { setKeepScreenOn });
    useAppStore.setState({ host });

    render(<MamepApp />);

    expect(setKeepScreenOn).not.toHaveBeenCalled();
  });

  it("keepAwake=true 时由能力矩阵放行 KeepAwake 桥", () => {
    const setKeepScreenOn = vi.fn();
    const { host } = makeHost({ keepAwake: true }, { setKeepScreenOn });
    useAppStore.setState({ host });

    render(<MamepApp />);

    expect(setKeepScreenOn).toHaveBeenCalledWith(false);
  });

  it("hardwareBack=false 时不订阅硬件返回键", () => {
    const onHardwareBack = vi.fn(() => () => undefined);
    const { host } = makeHost({ hardwareBack: false }, { onHardwareBack });
    useAppStore.setState({ host });

    render(<MamepApp />);

    expect(onHardwareBack).not.toHaveBeenCalled();
  });

  it("hardwareBack=true 时由能力矩阵放行返回键订阅", () => {
    const onHardwareBack = vi.fn(() => () => undefined);
    const { host } = makeHost({ hardwareBack: true }, { onHardwareBack });
    useAppStore.setState({ host });

    render(<MamepApp />);

    expect(onHardwareBack).toHaveBeenCalledTimes(1);
  });
});

describe("侧边栏分组标题可访问名称", () => {
  it("截断容器中的标题可聚焦并保留完整分组名称", () => {
    render(<MamepApp />);

    const groupTitle = screen.getByLabelText("HOLDING REGISTERS (R/W)");
    expect(groupTitle.getAttribute("tabindex")).toBe("0");
    expect(groupTitle.getAttribute("aria-label")).toBe(
      "HOLDING REGISTERS (R/W)",
    );
    expect(groupTitle.textContent).toBe("HOLDING REGISTERS (R/W)");
  });
});

describe("themeConfig（VSCode 完整主题注入 ConfigProvider，ADR-027）", () => {
  it("store.themeConfig 非空时 ConfigProvider 使用它（antd cssVar 输出对应 token）", () => {
    // 与 VscodeAppHost 装配路径一致：base + 覆盖合并后的完整配置。
    // 用表面色 token 断言（colorPrimary 会被 antd 色板派生转换，原值不可见）。
    useAppStore.getState().setThemeConfig(
      mergeThemeConfig(buildTheme(true), {
        token: { colorBgContainer: "#13579b" },
      }),
    );
    render(<MamepApp />);
    // antd cssVar 把 token 输出到 <head> 的 style（该值仅可能来自 themeConfig 覆盖）。
    expect(document.head.innerHTML).toContain(
      "--ant-color-bg-container:#13579b",
    );
  });

  it("store.themeConfig 为 null 时回退 buildTheme 两态（浏览器/Electron 路径）", () => {
    useAppStore.getState().setThemeConfig(null);
    useAppStore.getState().setTheme("dark");
    render(<MamepApp />);
    // 暗色 base 的布局色来自 buildTheme(dark) 回退路径。
    expect(document.head.innerHTML).toContain("--ant-color-bg-layout:#101014");
  });
});

describe("键盘快捷键（PRD §8.3 P1，2026-08-30）", () => {
  // 注：帮助/设置/连接设置等弹窗使用 React.lazy 懒加载（代码分割）：
  // 首次打开时才挂载对应 chunk，故断言用 `findBy*`（异步等待）而非 `getBy*`。
  // jsdom 下首次动态 import 需按需转换整条依赖链（实测 HelpDrawer 链路约 4–5s），
  // 默认 1s 等待不够——并行全量测试下会误报；这里显式放宽。
  const LAZY_MOUNT_TIMEOUT = { timeout: 20_000 } as const;
  // 用例级上限必须高于异步查询上限，并为并行转换/CPU 争抢预留余量。
  const LAZY_TEST_TIMEOUT_MS = 30_000;
  beforeEach(() => {
    useAppStore.setState({
      connectionModalOpen: false,
      settingsModalOpen: false,
      helpModalOpen: false,
      workspaceImportDraft: null,
      pendingDeleteSheetId: null,
      pendingBulkClose: null,
    });
  });

  function fireAppKey(
    key: string,
    mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
  ): void {
    fireEvent.keyDown(window, {
      key,
      ctrlKey: mods.ctrl ?? false,
      metaKey: false,
      shiftKey: mods.shift ?? false,
      altKey: mods.alt ?? false,
    });
  }

  it(
    "Ctrl+/ 打开帮助抽屉并渲染快捷键总览（app/table 两组）",
    async () => {
      render(<MamepApp />);
      fireAppKey("/", { ctrl: true });
      expect(useAppStore.getState().helpModalOpen).toBe(true);
      // 懒加载：抽屉首次打开时才下载/挂载 → 异步等待。
      await screen.findByText(
        "Keyboard Shortcuts",
        undefined,
        LAZY_MOUNT_TIMEOUT,
      );
      // 抽屉默认「快速上手」页签，需切换到「键盘快捷键」页签后才挂载表格。
      fireEvent.click(screen.getByText("Keyboard Shortcuts"));
      await waitFor(() => {
        expect(
          document.querySelectorAll(".keyboard-shortcuts__table").length,
        ).toBe(2);
      }, LAZY_MOUNT_TIMEOUT);
    },
    LAZY_TEST_TIMEOUT_MS,
  );

  it(
    "? 打开帮助弹窗（别名 = Shift+/）",
    async () => {
      render(<MamepApp />);
      fireAppKey("?", { shift: true });
      await screen.findByText(
        "Keyboard Shortcuts",
        undefined,
        LAZY_MOUNT_TIMEOUT,
      );
      expect(useAppStore.getState().helpModalOpen).toBe(true);
    },
    LAZY_TEST_TIMEOUT_MS,
  );

  it(
    "Ctrl+, 打开设置抽屉（容器为 Drawer）",
    async () => {
      render(<MamepApp />);
      fireAppKey(",", { ctrl: true });
      await screen.findByText("Theme", undefined, LAZY_MOUNT_TIMEOUT);
      expect(useAppStore.getState().settingsModalOpen).toBe(true);
      // 容器为 Drawer（store 字段名保留 settingsModalOpen）。
      expect(document.querySelector(".settings-drawer")).not.toBeNull();
    },
    LAZY_TEST_TIMEOUT_MS,
  );

  it(
    "Ctrl+Enter 未连接时打开连接设置弹窗",
    async () => {
      render(<MamepApp />);
      fireAppKey("Enter", { ctrl: true });
      await screen.findByText(
        "Connection Settings",
        undefined,
        LAZY_MOUNT_TIMEOUT,
      );
      expect(useAppStore.getState().connectionModalOpen).toBe(true);
    },
    LAZY_TEST_TIMEOUT_MS,
  );

  it("帮助弹窗打开后快捷键被抑制（Ctrl+, 不再触发）", () => {
    render(<MamepApp />);
    fireAppKey("/", { ctrl: true });
    expect(useAppStore.getState().helpModalOpen).toBe(true);
    fireAppKey(",", { ctrl: true });
    expect(useAppStore.getState().settingsModalOpen).toBe(false);
  });
});

describe("侧边栏 footer 按平台显示（bug 修复）", () => {
  function footerText(): string {
    return (
      document.querySelector<HTMLElement>(".sheet-sidebar__footer")
        ?.textContent ?? ""
    );
  }

  function renderWithPlatform(platform: AppHost["platform"]): void {
    const { host } = makeHost({}, { platform });
    useAppStore.setState({ host, loaded: true });
    render(<MamepApp />);
  }

  it("浏览器端显示 Browser", () => {
    renderWithPlatform("browser");
    expect(footerText()).toBe("Browser v0.0.0-test");
  });

  it("Electron 端显示 Client", () => {
    renderWithPlatform("electron");
    expect(footerText()).toBe("Client v0.0.0-test");
  });

  it("VSCode 端显示 Extension", () => {
    renderWithPlatform("vscode");
    expect(footerText()).toBe("Extension v0.0.0-test");
  });
});

describe("启动骨架（hostStatus，2026-09-13 装配按平台动态 import）", () => {
  it("assembling：显示骨架且不渲染主外壳", () => {
    useAppStore.setState({ host: null, hostStatus: "assembling" });
    render(<MamepApp />);

    expect(screen.getByTestId("app-startup")).toBeTruthy();
    expect(document.querySelector(".mamep-header")).toBeNull();
  });

  it("failed：不占位——应用以「无 Host」保持可操作", () => {
    useAppStore.setState({ host: null, hostStatus: "failed" });
    render(<MamepApp />);

    expect(screen.queryByTestId("app-startup")).toBeNull();
    expect(document.querySelector(".mamep-header")).not.toBeNull();
  });
});
