import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { LaunchedChrome } from "chrome-launcher";

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

/**
 * 为 chrome-launcher 预留固定的回环调试端口。
 *
 * 新版 Edge 在使用 `--remote-debugging-port=0` 时只把动态端口写入
 * `DevToolsActivePort`，chrome-launcher 1.2 仍只从 stderr 解析，导致 Lighthouse
 * 在浏览器已启动时误报 `waiting for dynamic debugging port`。固定端口可绕过该
 * 启动探测兼容问题；先向系统申请空闲端口并立即释放，随后由 chrome-launcher
 * 以固定端口启动 Edge。
 */
export function reserveDebuggingPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("failed to reserve a loopback debugging port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

/**
 * 回收 Lighthouse 启动的完整浏览器进程树。
 *
 * Windows 上仅向主进程发送结束信号时，GPU/渲染/网络等子进程可能变成孤儿并持续
 * 占用内存，且 Edge 可能在启动时把实际浏览器根进程从 launcher 的子进程链中
 * 重新挂接。因此按本次专属 user-data-dir 精确筛选进程并循环终止，最后删除该临时
 * 配置目录；其他平台继续使用 chrome-launcher 的进程终止。绝不会扫描默认用户配置。
 */
export function terminateLaunchedChrome(
  chrome: LaunchedChrome | undefined,
  userDataDir: string,
): void {
  if (process.platform === "win32") {
    const command = [
      "$profile = $env:MAMEP_LIGHTHOUSE_PROFILE",
      "for ($attempt = 0; $attempt -lt 3; $attempt++) {",
      "  $processes = @(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) })",
      "  if ($processes.Count -eq 0) { break }",
      "  $processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      "  Start-Sleep -Milliseconds 100",
      "}",
    ].join("\n");
    const result = spawnSync(
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        env: { ...process.env, MAMEP_LIGHTHOUSE_PROFILE: userDataDir },
        stdio: "ignore",
        windowsHide: true,
        timeout: 15_000,
      },
    );
    if (
      chrome !== undefined &&
      (result.error !== undefined || result.status !== 0)
    ) {
      chrome.kill();
    }
  } else {
    chrome?.kill();
  }
  try {
    rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // 临时浏览器配置清理失败不应覆盖性能报告或原始测试失败。
  }
}
