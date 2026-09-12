/**
 * VSCode 生产 Webview 的 CSP（docs/TECH_DESIGN.md §22.2，2026-09-10 ADR-050 抽出并修复）。
 *
 * 资源源必须用 `webview.cspSource`（VSCode 版本无关），`'self'` 保留兜底：VSCode 1.134+
 * 的 Webview 用 `'self'` 会拦截脚本，故构建期静态 CSP（`apps/web` 注入的那份）会被本策略替换。
 *
 * **`script-src ... blob:` 与 `worker-src ... blob:` 都是必需的**（2026-09-10 ADR-050；
 * 2026-09-12 ADR-055 补齐 `script-src`）：插件隔离运行时经 `new Worker(URL.createObjectURL(blob))`
 * 加载单文件 JS 插件，同进程路径经 `import(blobUrl)` 加载 entry；worker 内部的动态 `import()`
 * （以及 Webview 文档内的同进程加载）由 `script-src` 管控，仅放行 `worker-src` 仍会被
 * `script-src` 拦截（详因见 apps/web `src/csp.ts`）。
 */
export function buildWebviewCsp(cspSource: string): string {
  return [
    `default-src ${cspSource} 'self'`,
    // 插件 entry 经 blob: URL 动态 import（同进程加载 / Worker 内加载）。
    `script-src ${cspSource} 'self' blob:`,
    // 插件 Blob Worker（无此指令则回退到 script-src，blob: 被拦截）。
    `worker-src ${cspSource} 'self' blob:`,
    // antd CSS-in-JS 依赖内联 <style>，必须放行 unsafe-inline。
    `style-src ${cspSource} 'self' 'unsafe-inline'`,
    `img-src ${cspSource} 'self' data:`,
    `font-src ${cspSource} 'self' data:`,
    `connect-src ${cspSource} 'self'`,
  ].join("; ");
}
