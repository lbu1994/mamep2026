/**
 * VSCode 生产 Webview 的 CSP（docs/TECH_DESIGN.md §22.2，2026-09-10 ADR-050 抽出并修复）。
 *
 * 资源源必须用 `webview.cspSource`（VSCode 版本无关），`'self'` 保留兜底：VSCode 1.134+
 * 的 Webview 用 `'self'` 会拦截脚本，故构建期静态 CSP（`apps/web` 注入的那份）会被本策略替换。
 *
 * **`worker-src ... blob:` 是必需的**：插件隔离运行时经 `new Worker(URL.createObjectURL(blob))`
 * 加载单文件 JS 插件（`packages/platform-web/src/plugin-remote-runtime.ts`）。CSP 的 `worker-src`
 * 缺失时依次回退 `child-src` → `script-src` → `default-src`，`blob:` 不在其中 → 打包产物下
 * 可执行插件被拦截（dev 不注入 CSP，故此前未被发现）。
 */
export function buildWebviewCsp(cspSource: string): string {
  return [
    `default-src ${cspSource} 'self'`,
    `script-src ${cspSource} 'self'`,
    // 插件 Blob Worker（无此指令则回退到 script-src，blob: 被拦截）。
    `worker-src ${cspSource} 'self' blob:`,
    // antd CSS-in-JS 依赖内联 <style>，必须放行 unsafe-inline。
    `style-src ${cspSource} 'self' 'unsafe-inline'`,
    `img-src ${cspSource} 'self' data:`,
    `font-src ${cspSource} 'self' data:`,
    `connect-src ${cspSource} 'self'`,
  ].join("; ");
}
