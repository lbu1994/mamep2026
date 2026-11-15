/**
 * 快捷键注册表单测（PRD §8.3 P1）。
 * 覆盖：app/table 两级无冲突、浏览器保留键规避、别名指向有效、i18n 文案齐全、
 * matchesShortcut 精确修饰键匹配。
 */
import { describe, expect, it } from "vitest";
import {
  ALL_SHORTCUTS,
  APP_SHORTCUTS,
  matchesShortcut,
  TABLE_SHORTCUTS,
} from "./shortcuts";
import { en } from "../i18n";

type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

function evt(
  key: string,
  mods: Partial<
    Pick<KeyEventLike, "ctrlKey" | "metaKey" | "shiftKey" | "altKey">
  > = {},
): KeyEventLike {
  return {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
  };
}

describe("快捷键注册表", () => {
  it("app 与 table 两级无重复 combo（严格修饰键去重）", () => {
    const seen = new Map<string, string>();
    for (const def of ALL_SHORTCUTS) {
      const comboKey = JSON.stringify(def.combo);
      const prev = seen.get(comboKey);
      expect(prev, `combo 冲突：${def.id} 与 ${prev ?? "无"}`).toBeUndefined();
      seen.set(comboKey, def.id);
    }
  });

  it("不占用浏览器/系统保留键（白名单断言）", () => {
    const violations: string[] = [];
    for (const def of ALL_SHORTCUTS) {
      const c = def.combo;
      const isMod = c.mod === true || c.ctrl === true || c.meta === true;
      // 浏览器保留：Ctrl+W/T/N/R、Ctrl+Tab、Ctrl+1..9、F5/F12、Alt+←/→
      // （注意：Ctrl+Alt+W/T/N/R 等三键组合不是浏览器保留键，不在此列）。
      if (isMod && !c.alt && ["w", "t", "n", "r", "tab"].includes(c.key)) {
        violations.push(`${def.id} 使用了浏览器保留组合`);
      }
      if (isMod && !c.alt && /^[0-9]$/.test(c.key)) {
        violations.push(`${def.id} 使用了 Ctrl+数字`);
      }
      if (!isMod && !c.alt && ["f5", "f12"].includes(c.key)) {
        violations.push(`${def.id} 使用了 F5/F12`);
      }
      if (c.alt === true && ["arrowleft", "arrowright"].includes(c.key)) {
        violations.push(`${def.id} 使用了 Alt+←/→（浏览器历史）`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("别名（aliasOf）指向存在的 id，帮助弹窗隐藏别名行", () => {
    const ids = new Set(ALL_SHORTCUTS.map((s) => s.id));
    for (const def of ALL_SHORTCUTS) {
      if (def.aliasOf !== undefined) {
        expect(
          ids.has(def.aliasOf),
          `${def.id} 的 aliasOf=${def.aliasOf} 不存在`,
        ).toBe(true);
      }
    }
    const nonAlias = ALL_SHORTCUTS.filter((d) => d.aliasOf === undefined);
    const labels = new Set(nonAlias.map((d) => d.comboLabel));
    expect(nonAlias.map((d) => d.comboLabel)).toHaveLength(labels.size);
  });

  it("每条快捷键都有对应的 i18n 文案（en 为准，keyboard.<id>）", () => {
    const keyboard = en.keyboard as unknown as Record<string, string>;
    for (const def of ALL_SHORTCUTS) {
      expect(keyboard[def.id], `缺少 keyboard.${def.id}`).toBeTruthy();
    }
  });

  it("matchesShortcut：Ctrl+Enter 不命中 Ctrl+Shift+Enter（精确修饰键）", () => {
    const openSettings = APP_SHORTCUTS.find((s) => s.id === "openSettings")!;
    const writeSelected = TABLE_SHORTCUTS.find(
      (s) => s.id === "writeSelected",
    )!;
    expect(
      matchesShortcut(evt("Enter", { ctrlKey: true }), openSettings.combo),
    ).toBe(false);
    expect(
      matchesShortcut(
        evt("Enter", { ctrlKey: true, shiftKey: true }),
        writeSelected.combo,
      ),
    ).toBe(true);
    expect(
      matchesShortcut(evt("Enter", { ctrlKey: true }), writeSelected.combo),
    ).toBe(false);
  });

  it("matchesShortcut：无修饰键组合要求无修饰键；大小写不敏感", () => {
    const readAll = TABLE_SHORTCUTS.find((s) => s.id === "readAll")!;
    expect(matchesShortcut(evt("F9"), readAll.combo)).toBe(true);
    expect(matchesShortcut(evt("f9"), readAll.combo)).toBe(true);
    expect(matchesShortcut(evt("F9", { ctrlKey: true }), readAll.combo)).toBe(
      false,
    );
    // Shift+F9 不命中 F9
    expect(matchesShortcut(evt("F9", { shiftKey: true }), readAll.combo)).toBe(
      false,
    );
  });

  it("matchesShortcut：Alt+P 与 P 可区分；mod 组合在 macOS 下用 metaKey", () => {
    const togglePolling = TABLE_SHORTCUTS.find(
      (s) => s.id === "togglePolling",
    )!;
    expect(
      matchesShortcut(evt("p", { altKey: true }), togglePolling.combo),
    ).toBe(true);
    expect(matchesShortcut(evt("p"), togglePolling.combo)).toBe(false);
    const openSettings = APP_SHORTCUTS.find((s) => s.id === "openSettings")!;
    expect(
      matchesShortcut(evt(",", { metaKey: true }), openSettings.combo),
    ).toBe(true);
  });
});
