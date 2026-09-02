/**
 * ConnectionSettingsModal 浏览器兼容性（PRD §8.3 / §15.7，2026-09-02）：
 * - 浏览器不支持 Web Serial：警告 + 替代方案提示 + CONNECT 禁用（不得执行不可用串口操作）；
 * - 支持环境（supportsWebSerial=true）：无警告、CONNECT 可用；
 * - 非安全上下文：额外提示 Web Serial 需要安全上下文。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App as AntApp } from "antd";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import { makeHost } from "../test/make-app-host";
import { ConnectionSettingsModal } from "./ConnectionSettingsModal";

function renderModal(): void {
  useAppStore.setState({
    connectionModalOpen: true,
    workspace: useAppStore.getState().workspace,
  });
  render(
    <AntApp>
      <ConnectionSettingsModal />
    </AntApp>,
  );
}

/** CONNECT 按钮：footer Button 文本经 antd 包装，取文本节点最近的 button 元素。 */
function connectButton(): HTMLButtonElement | null {
  const el = screen.getByText("CONNECT");
  return el.closest("button");
}

const BROWSER_CAPS = {
  modbusTcp: false,
  serialPorts: "browser-picker" as const,
};

beforeEach(() => {
  initI18n();
  useAppStore.setState({
    host: null,
    workspace: createEmptyWorkspace(),
    connectionModalOpen: false,
  });
});

describe("ConnectionSettingsModal 浏览器兼容性（PRD §15.7）", () => {
  it("不支持 Web Serial：警告 + 替代方案提示，CONNECT 禁用", () => {
    const { host } = makeHost(BROWSER_CAPS, {
      browserCompatibility: {
        webSerial: false,
        secureContext: true,
        usable: false,
        issues: ["web-serial-missing"],
      },
    });
    useAppStore.setState({ host });
    renderModal();
    expect(screen.getByText(/Web Serial is not supported/)).toBeTruthy();
    expect(screen.getByText(/Chromium/)).toBeTruthy();
    expect(connectButton()?.disabled).toBe(true);
  });

  it("支持 Web Serial：无警告，CONNECT 可用", () => {
    const { host } = makeHost(BROWSER_CAPS, {
      supportsWebSerial: () => true,
      browserCompatibility: {
        webSerial: true,
        secureContext: true,
        usable: true,
        issues: [],
      },
    });
    useAppStore.setState({ host });
    renderModal();
    expect(screen.queryByText(/Web Serial is not supported/)).toBeNull();
    expect(connectButton()?.disabled).toBe(false);
  });

  it("非安全上下文：额外提示安全上下文要求", () => {
    const { host } = makeHost(BROWSER_CAPS, {
      browserCompatibility: {
        webSerial: true,
        secureContext: false,
        usable: false,
        issues: ["insecure-context"],
      },
    });
    useAppStore.setState({ host });
    renderModal();
    expect(screen.getByText(/secure context/)).toBeTruthy();
    expect(connectButton()?.disabled).toBe(true);
  });
});
