# Node TCP 适配

### 9.4 Node TCP Adapter

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


### 34.4 Modbus TCP 原型

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


