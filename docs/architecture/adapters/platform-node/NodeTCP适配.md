# Node TCP 适配

## 1. Node TCP Adapter

Electron 和 VSCode 共用 Node TCP Adapter。

职责：

1. DNS 或 IP 连接；
2. 连接超时；
3. Socket 错误；
4. 远端关闭；
5. 本地主动关闭；
6. 半包和粘包数据传递；
7. 阻止断开后继续写入；
8. 可取消连接；
9. 支持自动重连协调器使用；
10. 映射结构化错误。

是否自动重连不由 Adapter 决定，而由 Application 层的连接策略决定。


## 2. Modbus TCP 原型

验证：

- Electron 和 VSCode 中建立 TCP 连接；
- 主机名和 IP 地址解析；
- 连接超时；
- 对端拒绝连接；
- 半包和粘包；
- Transaction ID 匹配；
- Unit ID 匹配；
- 请求过程中断线；
- 主动断开；
- 自动重连期间主动取消；
- Electron 和 VSCode 是否能够复用同一 Node TCP Adapter。

## 3. 验证结论与错误边界

已验证：

- 注入式 Fake Socket 覆盖打开、关闭、读写、未打开写入、重复打开、连接拒绝、被动关闭、事件退订和监听器压力；
- Node `net` 本地回环覆盖真实字节收发、`0x00/0xFF`、分片重组、服务端断开和关闭重连；
- IPv4/IPv6、TLS 不支持、Unit ID 0–255、端口 1–65535 的能力描述；
- Electron Main 和 VSCode Extension Host 已接入同一 Node TCP Adapter。

主要错误映射：

- `ECONNREFUSED`、`EHOSTUNREACH`、`ENETUNREACH`、`ENOTFOUND`、`EAI_AGAIN`、`ETIMEDOUT`、`ECONNRESET`、`EPIPE` → `TCP_CONNECTION_FAILED`；
- `EADDRINUSE` / address already in use → `TCP_PORT_IN_USE`；
- 未知打开错误 → `TCP_OPEN_FAILED`；
- 未打开写入 → `TRANSPORT_NOT_OPEN`；
- 浏览器能力缺失 → `TCP_UNSUPPORTED`。

TCP 连接失败可重试；端口占用属于权限/资源冲突，不应无限重试。自动重连、超时和请求重试由 Application 层策略决定，Adapter 只报告连接状态和结构化错误。

仍需目标环境验证：

- 真实设备、IPv6 网络和大报文；
- 长时间轮询与内存稳定性；
- 打包后原生/网络模块行为；
- macOS/Linux 的端到端连接。

---


