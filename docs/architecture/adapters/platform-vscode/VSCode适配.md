# VSCode 平台适配

## 1. VSCode 持久化

VSCode 使用两层存储：

1. workspaceState 或 globalState；
2. 可选工作区配置文件。

workspaceState/globalState 保存：

- 当前应用状态；
- UI 布局；
- 最近使用信息；
- 不适合共享的本地状态。

工作区配置文件保存：

- 可跨机器或团队共享的寄存器表；
- 标签页；
- 备注；
- 非敏感配置。

Repository 实现必须同时支持 VSCode Storage 与工作区文件两种后端。


## 2. VSCode Webview RPC

要求：

- Webview 使用严格 CSP；
- 资源使用 Webview 安全 URI；
- 使用 nonce；
- 不启用不需要的权限；
- 所有消息由 Extension Host 校验；
- 工作区未受信任时限制高风险能力；
- Webview 销毁时取消订阅；
- Extension 停用时释放连接；
- 不把任意文件系统能力暴露给 Webview；
- 插件能力由 Extension Host 控制。

---


