import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import { BottomPanel } from "./BottomPanel";

describe("BottomPanel messages", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: useAppStore.getState().workspace,
      messages: [],
      commLog: [],
    });
  });

  it("translates known message keys instead of showing the raw key", () => {
    useAppStore.setState({
      messages: [
        {
          timestamp: Date.now(),
          level: "info",
          messageKey: "messages.appStarted",
          detail: null,
        },
      ],
    });
    render(<BottomPanel />);
    expect(screen.getByText("Application started (offline).")).toBeTruthy();
    expect(screen.queryByText("messages.appStarted")).toBeNull();
  });

  it("renders interpolated params for parameterized messages", () => {
    useAppStore.setState({
      messages: [
        {
          timestamp: Date.now(),
          level: "info",
          messageKey: "messages.writeSucceeded",
          params: { address: "12AB" },
          detail: null,
        },
      ],
    });
    render(<BottomPanel />);
    expect(screen.getByText("Write succeeded (12AB).")).toBeTruthy();
  });

  it("falls back to the raw text for unknown plugin keys", () => {
    useAppStore.setState({
      messages: [
        {
          timestamp: Date.now(),
          level: "info",
          messageKey: "plugin.custom.event",
          detail: null,
        },
      ],
    });
    render(<BottomPanel />);
    expect(screen.getByText("plugin.custom.event")).toBeTruthy();
  });
});
