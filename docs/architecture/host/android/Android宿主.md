# Android 宿主

## 1. 宿主组合

Android 是第四平台，使用 Capacitor 容器和 `AndroidAppHost`。宿主采用混合装配：

- 通用工作区、UI、插件和本地能力委托共享的浏览器 Host 实现；
- Modbus TCP 与 USB-RS485 通过 `packages/platform-android` 的 Host/Transport 适配器承载；
- UI 和共享包不得直接调用 Capacitor 原生插件；
- Capacitor 原生插件只允许出现在 `apps/android` 和 `packages/platform-android`；
- 协议、调度、转换和 Trace 继续复用共享实现，不在原生层复制 Modbus 业务规则。

桥接协议采用版本化方法白名单、Zod 校验和 base64 字节载荷。原生侧只负责字节流、设备授权和连接生命周期，不实现功能码语义。

## 2. 平台能力

Android 能力矩阵由静态基线加必要的运行时探测生成：

- Modbus TCP：支持；
- USB-RS485：支持，经 USB Host 权限和串口枚举；
- 浏览器式 Web Serial：不适用；
- 插件安装：上传本地 manifest 或单文件可执行插件；
- 可执行插件：启动时运行时探测 Blob Worker 和 Worker 内动态 import 能力，失败时保持 fail-closed；
- Host 插件：不加载；
- 文件系统：通过 Capacitor Filesystem 分阶段实现。

不支持的能力必须如实声明，不得因为其他平台支持而翻转 Android 能力位。

## 3. 插件安装与执行

Android 的插件安装能力为 `pluginInstall: "upload"`，使用 WebView 文件输入读取本地文件，不依赖 Capacitor Filesystem。文件输入以 `.json`、`.mjs`、`.js` 扩展名过滤；过滤只用于改善设备文件选择器的可操作性，最终以 Manifest Schema 校验文件内容。

`executablePlugins` 的静态值 `false` 是 fail-closed 基线。Android Host 工厂在构造 `AndroidAppHost` 前执行一次运行时探测，只有探测成功才用结果覆盖该字段：

- 探测复用生产环境的隔离插件运行时链路，即创建 Blob Worker 并在 Worker 内动态 import 自包含 entry；
- 同时验证 Worker 创建与 Worker 内脚本 import，不能只检查版本号或 API 是否存在；
- 默认超时 3000 ms，超时、Worker 创建失败、entry 加载失败或异常均视为不可用；
- 无论成功、失败或超时都必须终止 Worker 并释放计时器；
- 探测只修改 `executablePlugins`，不得改写其他能力位；
- 能力在首次读取 `host.capabilities` 前定型，不新增响应式能力信号。

Android 与桌面端一致，可执行插件默认使用隔离执行；`same-process` 必须在安装确认框中由用户显式授权。当前探测针对隔离 Blob Worker 路径，不对 `same-process` 的文档内 blob import 单独门控；若某 WebView 拦截该路径，安装会在加载阶段以结构化插件错误失败。探测失败不增加独立启动提示，用户尝试安装可执行插件时沿用既有不可支持或加载失败文案。

Android Host 工厂是异步装配：探测完成后必须再次检查装配取消信号；取消时释放探测资源且不构造、不接线 Host。探测结果不是持续健康检查，每次应用启动最多重新判定一次。

Android 没有 Node 宿主执行面，`hostPlugins` 始终为 `false`。生产 CSP 只额外放行 `worker-src 'self' blob:` 和 `script-src 'self' blob:`，不放宽远程脚本、内联脚本或 `eval`。

## 4. 移动布局与交互

移动布局统一使用 1023px 断点；平板横屏优先使用桌面布局，手机竖屏使用：

- 左侧表列表 Drawer；
- 底部面板抽屉；
- 横向滚动表格；
- 工具栏“更多”面板；
- 触摸目标至少 48dp；
- 安全区适配；
- 硬件返回键按覆盖层栈关闭最上层抽屉或最小化。

虚拟表格行距移动端为 44px；桌面为 29px。行高常量与虚拟滚动配置必须一致。
窄屏不为表格固定左侧列，避免固定列占用可视宽度并与横向触摸手势竞争；列宽调整
和列拖拽排序在移动布局关闭。长按行菜单、外部键盘和软键盘避让都属于移动端
交互能力，不能用桌面 hover 或右键语义冒充。

## 5. 生命周期

- 页面进入后台时暂停轮询和 Trace，保留配置，回到前台后恢复；
- 后台事件由 Capacitor `appStateChange` 与 `visibilitychange` 双通道驱动，
  处理必须幂等；进入后台时同时执行工作区 flush；
- 设备拔出时停止持续任务并提示用户；
- 存在轮询或 Trace 行时申请保持屏幕常亮；
- 硬件返回键先关闭覆盖层栈中最上层 Drawer/Modal，未消费时才最小化应用；
- 屏幕旋转不得重建并意外断开原生连接；
- 关闭页面、重建连接或卸载时释放 Timer、监听器和原生连接；
- 工作区恢复后保持离线，不自动连接设备。

Android 新建或回填连接 profile 时使用该平台的 300 ms 请求超时和 2 次重试
默认值。覆盖只发生在 Android composition root，不改变共享默认配置；传输桥
只承载字节，不能因默认值不同复制一份协议栈。

## 6. 构建与验证边界

- Capacitor 8 与 Gradle 8.14 需要 JDK 21/17；不得使用 JDK 25 直接构建；
- `pnpm build:android` 执行 Web Android 产物、`cap sync` 和 Debug APK 构建；
- Release 签名材料齐全时才绑定 release signing；缺失时生成 unsigned APK/AAB 并明确提示，禁止静默复用 Debug key；
- 真机自动化通过 CDP 驱动 WebView，不依赖不可用的 `adb logcat`；
- 设备安装辅助应优先使用非流式安装，兼容 OEM 对流式安装的静默拒绝；
- Android 真机 e2e 使用独立命令，不并入无设备环境可运行的全量套件。

桥接延迟只占默认请求超时的很小部分，因此帧解析仍保留在共享 JS 层；若未来实测不足，仍只能替换 Transport 适配，不得改变上层协议和会话契约。

---

