import type { MenuProps } from "antd/es/menu";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  VerticalRightOutlined,
} from "@ant-design/icons";
import type { TFunction } from "i18next";
import type { SheetId } from "@mamep2026/domain";

/** 表格级菜单回调：侧栏与表标题栏共用同一组动作语义。 */
export interface SheetMenuActions {
  onRename: (sheetId: SheetId) => void;
  onDuplicate: (sheetId: SheetId) => void;
  /** 关闭除目标表外的所有表（破坏性，需确认）。 */
  onCloseOthers: (sheetId: SheetId) => void;
  /** 关闭目标表右侧的所有表（破坏性，需确认）。 */
  onCloseToRight: (sheetId: SheetId) => void;
  onMoveUp: (sheetId: SheetId) => void;
  onMoveDown: (sheetId: SheetId) => void;
  onDelete: (sheetId: SheetId) => void;
}

/**
 * 构建表格上下文菜单项（Rename / Duplicate / Close Others / Close Right / Move Up / Move Down / Delete）。
 * 侧栏表项与表标题栏复用，保证两处菜单行为一致。
 */
export function buildSheetMenuItems(
  t: TFunction,
  sheetId: SheetId,
  index: number,
  total: number,
  actions: SheetMenuActions,
): NonNullable<MenuProps["items"]> {
  return [
    {
      key: "rename",
      label: t("table.renameSheet"),
      icon: <EditOutlined />,
      onClick: () => actions.onRename(sheetId),
    },
    {
      key: "duplicate",
      label: t("table.duplicateSheet"),
      icon: <CopyOutlined />,
      onClick: () => actions.onDuplicate(sheetId),
    },
    { type: "divider" },
    {
      key: "close-others",
      label: t("table.closeOthers"),
      icon: <CloseCircleOutlined />,
      disabled: total <= 1,
      onClick: () => actions.onCloseOthers(sheetId),
    },
    {
      key: "close-right",
      label: t("table.closeToRight"),
      icon: <VerticalRightOutlined />,
      disabled: index === total - 1,
      onClick: () => actions.onCloseToRight(sheetId),
    },
    { type: "divider" },
    {
      key: "up",
      label: t("table.moveUp"),
      icon: <ArrowUpOutlined />,
      disabled: index === 0,
      onClick: () => actions.onMoveUp(sheetId),
    },
    {
      key: "down",
      label: t("table.moveDown"),
      icon: <ArrowDownOutlined />,
      disabled: index === total - 1,
      onClick: () => actions.onMoveDown(sheetId),
    },
    { type: "divider" },
    {
      key: "delete",
      label: t("table.deleteSheet"),
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => actions.onDelete(sheetId),
    },
  ];
}
