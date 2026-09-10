/**
 * 生产构建 CSP（docs/TECH_DESIGN.md §22.1、§22.4）。
 *
 * 由 `vite.config.ts` 的 `injectCspMeta()` 在 build 阶段注入到 `index.html` 的 `<meta>`
 * （dev 不注入以保留 HMR）。浏览器 / Electron / VSCode 渲染器 / Android 四端产物共用同一份策略。
 *
 * **`worker-src 'self' blob:` 是必需的**（2026-09-10，ADR-050）：
 * 插件隔离运行时经 `new Worker(URL.createObjectURL(blob))` 加载单文件 JS 插件
 * （`packages/platform-web/src/plugin-remote-runtime.ts`）。CSP 的 `worker-src` 在缺失时
 * 依次回退 `child-src` → `script-src` → `default-src`，而 `'self'` **不匹配** `blob:`，
 * 因此缺少该指令时打包产物下的可执行插件会被 CSP 拦截（dev 不注入 CSP，故此前未被发现）。
 */
export function buildWebCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // 插件 Blob Worker（无此指令则回退到 script-src 'self'，blob: 被拦截）。
    "worker-src 'self' blob:",
    // antd CSS-in-JS 依赖内联 <style>，必须放行 unsafe-inline。
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
  ].join("; ");
}
