# Release Notes

## v0.1.0 (2026-08-03)

### 新增

- Modbus RTU 串口通信支持（Web Serial API）
- 03H 读保持寄存器 / 10H 写多个寄存器
- 不连续寄存器单表格监控（固定 15 行 × 10 列）
- Upload 逐行轮询读取 TM 勾选行
- 单行 READ / WRITE 即时操作
- 写入插队机制（Upload 过程中可插入写入）
- 数据格式切换：HEX / Unsigned Dec. / Signed Dec.
- 可折叠侧边栏（Project Bar Register Mode / Address Mode）
- Comment 注释列
- 底部消息面板（Message List 等 4 个标签页，Mock 数据）
- 串口配置弹窗（14 项参数，Demo 启用 7 项）
- 连接成功弹窗自动关闭
- Edge 浏览器串口连接超时兼容

### 技术栈

- React 18 + TypeScript + Vite 5 + Tailwind CSS
- Web Serial API（仅 Chromium 系浏览器）
