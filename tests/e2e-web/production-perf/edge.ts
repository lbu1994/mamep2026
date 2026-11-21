import { existsSync } from "node:fs";
import { join } from "node:path";

/** 返回系统 Microsoft Edge 可执行文件；性能门禁不允许回退到下载的 Chromium。 */
export function resolveEdgeExecutable(): string {
  const candidates = [
    process.env.MAMEP_EDGE_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    process.env["PROGRAMFILES(X86)"]
      ? join(
          process.env["PROGRAMFILES(X86)"],
          "Microsoft/Edge/Application/msedge.exe",
        )
      : undefined,
    process.env["ProgramFiles(x86)"]
      ? join(
          process.env["ProgramFiles(x86)"],
          "Microsoft/Edge/Application/msedge.exe",
        )
      : undefined,
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe")
      : undefined,
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Microsoft/Edge/Application/msedge.exe")
      : undefined,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Microsoft/Edge/Application/msedge.exe")
      : undefined,
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
  ];
  const executable = candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && existsSync(candidate),
  );
  if (executable === undefined) {
    throw new Error(
      "Microsoft Edge 未找到；请安装系统 Edge 或设置 MAMEP_EDGE_PATH。",
    );
  }
  return executable;
}
