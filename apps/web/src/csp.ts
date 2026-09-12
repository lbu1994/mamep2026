/**
 * 生产构建 CSP（docs/TECH_DESIGN.md §22.1、§22.4）。
 *
 * 由 `vite.config.ts` 的 `injectCspMeta()` 在 build 阶段注入到 `index.html` 的 `<meta>`
 * （dev 不注入以保留 HMR）。浏览器 / Electron / VSCode 渲染器 / Android 四端产物共用同一份策略。
 *
 * **`worker-src 'self' blob:` 与 `script-src 'self' blob:` 都是必需的**（2026-09-10，ADR-050；
 * 2026-09-12 ADR-055 补齐 `script-src`）：
 * 插件隔离运行时经 `new Worker(URL.createObjectURL(blob))` 加载单文件 JS 插件，同进程路径经
 * `import(blobUrl)` 加载 entry（`packages/platform-web/src/plugin-remote-runtime.ts` /
 * `plugin-local-runtime.ts`）。CSP 的 `worker-src` 在缺失时依次回退 `child-src` →
 * `script-src` → `default-src`，而 `'self'` **不匹配** `blob:`；**但 worker 内部的动态
 * `import()`（以及文档内的同进程加载）由 `script-src` 管控** —— 仅放行 `worker-src` 仍会在
 * Worker 内 import blob entry 时被 `script-src 'self'` 拦截（实测报错：Loading the script
 * 'blob:...' violates ... "script-src 'self'"）。故两条指令都需 `blob:`。
 * （dev 不注入 CSP，故此类问题只在打包产物暴露。）
 */
export function buildWebCsp(): string {
  return [
    "default-src 'self'",
    // 插件 entry 经 blob: URL 动态 import（同进程加载 / Worker 内加载）。
    "script-src 'self' blob:",
    // 插件 Blob Worker（无此指令则回退到 script-src 'self'，blob: 被拦截）。
    "worker-src 'self' blob:",
    // antd CSS-in-JS 依赖内联 <style>，必须放行 unsafe-inline。
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
  ].join("; ");
}
