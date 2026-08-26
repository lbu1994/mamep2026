/**
 * VSCode 端主题完整适配 e2e（UI 级，ADR-027）。
 *
 * 生产 webview（vscode-webview:// frame）内验证：ui-theme 把 --vscode-* 主题色映射为
 * antd cssVar token（--ant-color-*），antd 表面 token 实时跟随 VSCode 主题（container=
 * editor-background、layout=sideBar-background）；会话中切换 workbench 主题实时生效；
 * 面板关闭重开主题令牌仍正确；无 console 错误。
 *
 * 门控：MAMEP_REAL=1（由 scripts/e2e-real.mjs 触发 pnpm test:e2e:vscode:real）。
 * 不依赖串口/TCP，仅验证主题链路。
 */
import { expect, test } from "vscode-test-playwright";
import type { Frame, Page } from "@playwright/test";

test.skip(
  process.env.MAMEP_REAL !== "1",
  "真实端口测试需显式开启（MAMEP_REAL=1，由 pnpm test:e2e:vscode:real 触发）",
);

/**
 * 等待承载共享 UI 的 webview 内容 frame 出现。
 * VSCode 1.134 webview 为两层：容器 frame（vscode-webview://.../index.html）内嵌
 * 内容 frame（vscode-webview://.../fake.html，承载 #root/.ant-app 共享 UI）。
 * 按 url 前缀会误匹配容器 frame，须定位含 UI 的内容 frame（2026-08-25 实测）。
 */
async function waitForWebviewFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (!f.url().startsWith("vscode-webview://")) continue;
      try {
        const hasUi = await f.evaluate(
          () =>
            document.querySelector("#root .ant-app, .ant-layout") !== null,
        );
        if (hasUi) return f;
      } catch {
        // frame 可能尚未就绪，轮询重试。
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "webview UI frame 未出现（确认已 pnpm build:vscode 且 webview 已加载共享 UI）",
  );
}

interface ThemeVars {
  antBgContainer: string;
  antBgLayout: string;
  vscEditorBg: string;
  vscSideBarBg: string;
}

const EMPTY_VARS: ThemeVars = {
  antBgContainer: "",
  antBgLayout: "",
  vscEditorBg: "",
  vscSideBarBg: "",
};

/**
 * 读取 webview 内 antd cssVar 与 VSCode 主题色（原始值）。antd cssVar 可能在 :root 或
 * 带 css-var 类的包装元素上，遍历候选元素取首个非空值。读取失败（frame 关闭/未挂载）
 * 返回空，由调用方 poll 重试。
 */
async function themeVars(frame: Frame): Promise<ThemeVars> {
  try {
    return await frame.evaluate(() => {
      const getVar = (el: Element, name: string): string =>
        getComputedStyle(el).getPropertyValue(name).trim();
      const read = (name: string): string => {
        const rootValue = getVar(document.documentElement, name);
        if (rootValue !== "") return rootValue;
        for (const el of Array.from(
          document.querySelectorAll<Element>('[class*="css-var"]'),
        )) {
          const value = getVar(el, name);
          if (value !== "") return value;
        }
        return getVar(document.body, name);
      };
      return {
        antBgContainer: read("--ant-color-bg-container"),
        antBgLayout: read("--ant-color-bg-layout"),
        vscEditorBg: read("--vscode-editor-background"),
        vscSideBarBg: read("--vscode-sideBar-background"),
      };
    });
  } catch {
    return EMPTY_VARS;
  }
}

/** 断言 antd 表面 token 已跟随 VSCode 主题色（container=editor、layout=sideBar）。 */
async function expectThemeFollows(
  frame: Frame,
  options: { timeout?: number; message?: string } = {},
): Promise<void> {
  await expect
    .poll(
      async () => {
        const v = await themeVars(frame);
        // container 必须等于 editor-background；layout 优先等于 sideBar-background
        // （VSCode Light/Dark Modern 均提供 sideBar-background）。
        return (
          v.antBgContainer !== "" &&
          v.antBgContainer === v.vscEditorBg &&
          (v.antBgLayout === v.vscSideBarBg || v.antBgLayout === v.vscEditorBg)
        );
      },
      {
        timeout: options.timeout ?? 15_000,
        message:
          options.message ??
          "antd token 未跟随 VSCode 主题色（ui-theme 完整令牌映射未生效？）",
      },
    )
    .toBe(true);
}

test("VSCode 主题完整适配（UI 级）：跟随 + 实时切换 + 面板重开", async ({
  workbox,
  evaluateInVSCode,
}) => {
  const consoleErrors: string[] = [];
  workbox.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // VS Code 自身基础设施（扩展市场查询 / 网络资源加载）的报错与 webview 应用无关，
    // 且为网络环境性 flaky，不纳入「无 console 错误」断言；只统计来自共享 UI webview
    // （vscode-webview://）的 console 错误（2026-08-26 real e2e 修复）。
    const sourceUrl = msg.location()?.url ?? "";
    if (!sourceUrl.startsWith("vscode-webview://")) return;
    consoleErrors.push(`CONSOLE: ${msg.text()}`);
  });
  workbox.on("pageerror", (err) =>
    consoleErrors.push(`PAGEERROR: ${String(err)}`),
  );
  await workbox.setViewportSize({ width: 1600, height: 900 });

  await evaluateInVSCode((vscode) =>
    vscode.commands.executeCommand("mamep2026.openMainPanel"),
  );
  const frame = await waitForWebviewFrame(workbox);

  await test.step("当前主题下 antd token 跟随 VSCode 主题色（完整令牌映射生效）", async () => {
    await expectThemeFollows(frame);
  });

  await test.step("切到 Light Modern：antd token 实时跟随", async () => {
    await evaluateInVSCode(async (vscode) => {
      await vscode.workspace
        .getConfiguration("workbench")
        .update("colorTheme", "Light Modern", vscode.ConfigurationTarget.Global);
    });
    await expectThemeFollows(frame, {
      message: "切到浅色后 antd token 未跟随（实时更新失败？）",
    });
    // 浅色容器背景不应是暗色默认 #1e1e1e（与暗色起点区分）。
    const v = await themeVars(frame);
    expect(v.antBgContainer.toLowerCase()).not.toBe("#1e1e1e");
  });

  await test.step("切到 Dark Modern：antd token 实时跟随", async () => {
    await evaluateInVSCode(async (vscode) => {
      await vscode.workspace
        .getConfiguration("workbench")
        .update("colorTheme", "Dark Modern", vscode.ConfigurationTarget.Global);
    });
    await expectThemeFollows(frame, {
      message: "切到暗色后 antd token 未跟随（实时更新失败？）",
    });
  });

  await test.step("面板关闭重开：主题令牌仍正确", async () => {
    await evaluateInVSCode((vscode) =>
      vscode.commands.executeCommand("workbench.action.closeActiveEditor"),
    );
    await evaluateInVSCode((vscode) =>
      vscode.commands.executeCommand("mamep2026.openMainPanel"),
    );
    // 新面板 frame：轮询直到某个 webview frame 的 token 正确跟随（容忍旧 frame 残留）。
    await expect
      .poll(
        async () => {
          const candidates = workbox
            .frames()
            .filter((f) => f.url().startsWith("vscode-webview://"));
          for (const candidate of candidates) {
            const v = await themeVars(candidate);
            if (
              v.antBgContainer !== "" &&
              v.antBgContainer === v.vscEditorBg
            ) {
              return true;
            }
          }
          return false;
        },
        {
          timeout: 20_000,
          message: "面板重开后主题令牌未跟随 VSCode 主题",
        },
      )
      .toBe(true);
  });

  expect(consoleErrors).toEqual([]);
});
