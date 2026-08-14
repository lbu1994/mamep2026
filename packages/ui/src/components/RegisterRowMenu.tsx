import type { MenuProps } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  ScissorOutlined,
  SnippetsOutlined,
} from "@ant-design/icons";
import type { TFunction } from "i18next";
import type { RowId } from "@mamep2026/domain";

/** 行级右键菜单回调：动作复用 app-store action，不重复实现业务逻辑。 */
export interface RowMenuActions {
  onInsertAbove: (rowId: RowId) => void;
  onInsertBelow: (rowId: RowId) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
}

export interface RowMenuContext {
  /** 右键目标行；保证已包含在当前选中集合中。 */
  rowId: RowId;
  /** 当前选中行数（供菜单项提示）。 */
  selectionCount: number;
}

/**
 * 构建表格内行级右键菜单（插入上方/下方、上移/下移、复制、剪切、粘贴、删除）。
 * 参照 SheetMenu.buildSheetMenuItems 的构建模式；删除沿用现有无确认策略。
 */
export function buildRowMenuItems(
  t: TFunction,
  ctx: RowMenuContext,
  actions: RowMenuActions,
): NonNullable<MenuProps["items"]> {
  return [
    {
      key: "insertAbove",
      label: t("table.insertRowAbove"),
      icon: <PlusOutlined />,
      onClick: () => actions.onInsertAbove(ctx.rowId),
    },
    {
      key: "insertBelow",
      label: t("table.insertRowBelow"),
      icon: <PlusOutlined />,
      onClick: () => actions.onInsertBelow(ctx.rowId),
    },
    { type: "divider" },
    {
      key: "moveUp",
      label: t("table.moveUp"),
      icon: <ArrowUpOutlined />,
      onClick: () => actions.onMoveUp(),
    },
    {
      key: "moveDown",
      label: t("table.moveDown"),
      icon: <ArrowDownOutlined />,
      onClick: () => actions.onMoveDown(),
    },
    { type: "divider" },
    {
      key: "copy",
      label: t("table.copy"),
      icon: <CopyOutlined />,
      onClick: () => actions.onCopy(),
    },
    {
      key: "cut",
      label: t("table.cut"),
      icon: <ScissorOutlined />,
      onClick: () => actions.onCut(),
    },
    {
      key: "paste",
      label: t("table.paste"),
      icon: <SnippetsOutlined />,
      onClick: () => actions.onPaste(),
    },
    { type: "divider" },
    {
      key: "delete",
      label: t("table.deleteRow"),
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => actions.onDelete(),
    },
  ];
}
