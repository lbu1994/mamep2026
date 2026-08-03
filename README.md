# Mamep2026 Demo

基于 Web 的 Modbus RTU 调试工具 Demo，复刻优化 Mamep2006 的核心交互体验。

## 技术栈

- React 18 + TypeScript
- Vite 5
- Tailwind CSS (indigo 主色调)
- Web Serial API

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览构建产物
npm run preview
```

## 浏览器要求

仅支持 **Chromium 系浏览器**（Chrome / Edge / Opera 等），需要 Web Serial API 支持。

## 界面布局

```
┌──────────────────────────────────────────┐
│ 顶部导航栏    Mamep2026 Demo  [串口设置] [插件] │
├──────┬───────────────────────────────────┤
│可折叠│ 标签页 + 功能操作栏                  │
│侧边栏│ [Upload] [Enter(ROM)] [Enter(RAM)] │
│      │ ┌─ 寄存器表格 (15行) ──────────────┐│
│      │ │No│TM│Name│Reg│WP│Read│Data│...  ││
│      │ │  │  │    │   │  │    │    │     ││
│      │ └─────────────────────────────────┘│
├──────┴───────────────────────────────────┤
│ 底部消息面板  [Message List] [Comm.Log]...│
└──────────────────────────────────────────┘
```

## Demo 功能范围

- ✅ Modbus RTU 串口通信（03H 读保持寄存器 / 10H 写多个寄存器）
- ✅ 不连续寄存器单表格批量监控（15 行 × 10 列）
- ✅ Upload 逐行轮询读取
- ✅ 单行 READ / WRITE 即时操作
- ✅ 写入插队（Upload 过程中可插入写入操作）
- ✅ 数据格式切换（HEX / Unsigned Dec. / Signed Dec.）
- ✅ 可折叠侧边栏（Register Mode / Address Mode）
- ✅ Comment 注释列
- ✅ 连接成功弹窗自动关闭
- ✅ Edge 浏览器兼容

后续计划：Modbus TCP、插件系统、更多功能码支持。

## 版本历史

详见 [RELEASENOTE.md](RELEASENOTE.md)

## 设计规则

- **布局结构**：可模仿参考软件的控件位置和交互逻辑
- **配色风格**：禁止老式 Windows 灰色系，使用现代 indigo / emerald 配色

## 项目结构

```
src/
├── main.tsx                  # React 入口
├── App.tsx                   # 根组件，全局状态 + 异步通信
├── components/
│   ├── AppHeader.tsx         # 顶部导航栏
│   ├── Sidebar.tsx           # 可折叠侧边栏
│   ├── SerialConfigModal.tsx # 串口配置弹窗
│   ├── TabToolbar.tsx        # 功能操作栏
│   ├── RegisterTable.tsx     # 核心寄存器表格
│   └── MessageBar.tsx        # 底部消息面板
├── lib/
│   ├── modbus.ts            # RTU 帧编解码 + CRC16
│   ├── serial.ts            # Web Serial API 封装
│   └── types.ts             # 类型定义
└── hooks/
    └── useSerial.ts         # 串口连接状态 Hook
```
