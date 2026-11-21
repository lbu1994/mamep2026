/**
 * 把已通过迁移/Schema 校验的普通数据重建为领域对象。
 *
 * 该模块刻意不导入 Zod 或迁移实现，供主线程接收 Worker 校验结果后做低成本的
 * 值对象重建。
 */
import {
  RawRegisterValue,
  RegisterAddress,
  type ConnectionProfileId,
  type PluginId,
  type RowId,
  type SheetId,
  type Workspace,
  type WorkspaceId,
} from "@mamep2026/domain";
import type { WorkspaceData } from "./schema";

export function hydrateWorkspaceData(data: WorkspaceData): Workspace {
  const sheets = data.sheets.map((sheet) => {
    const rows = sheet.rows.map((row) => {
      const addressResult =
        row.addressValue === null
          ? null
          : RegisterAddress.create(row.addressValue);
      if (addressResult !== null && !addressResult.ok) {
        throw new Error(`stored address invalid: ${String(row.addressValue)}`);
      }
      const registerValues =
        row.registerValues === null
          ? null
          : row.registerValues.map((value) => {
              const created = RawRegisterValue.create(value);
              if (!created.ok) {
                throw new Error(`stored raw value invalid: ${String(value)}`);
              }
              return created.value;
            });
      return {
        ...row,
        rowId: row.rowId as RowId,
        addressValue: addressResult === null ? null : addressResult.value,
        registerValues,
      };
    });
    return { ...sheet, sheetId: sheet.sheetId as SheetId, rows };
  });

  return {
    ...data,
    workspaceId: data.workspaceId as WorkspaceId,
    activeSheetId: data.activeSheetId as SheetId | null,
    connectionProfiles: data.connectionProfiles.map((profile) => ({
      ...profile,
      id: profile.id as ConnectionProfileId,
    })),
    activeConnectionProfileId:
      data.activeConnectionProfileId as ConnectionProfileId | null,
    sheets,
    pluginStates: data.pluginStates.map((state) => ({
      ...state,
      pluginId: state.pluginId as PluginId,
    })),
  };
}
