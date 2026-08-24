# Mamep2026 应用图标 — AI 生成提示词

> 用途：让 AI 图标生成工具（Midjourney / DALL·E / Ideogram / Recraft / Stable Diffusion 等）为本项目生成应用图标 / Logo。
> 用法：把「2. 概念方向」中的完整提示词复制进目标工具；英文提示词对多数工具效果最佳，中文提示词可作对照理解。

---

## 1. 项目设计简报（给 AI 工具的品牌背景）

生成前把下面这段「简报」附在提示词前面，帮助工具理解产品语义：

```
Design an app icon for "Mamep2026", a professional Modbus industrial
communication debugging tool that runs on three platforms: web browser,
desktop (Electron), and VS Code extension.

Product core concepts:
- Modbus protocol (serial RTU over COM port, and TCP over network)
- Register table: monitoring and editing holding registers (FC03 read / FC0x10 write)
- Master-slave polling between a host and industrial devices (PLCs, sensors, meters)
- Data read/write, communication logs, trace windows, multi-tab workspace

Target users: embedded software engineers, device application developers,
and communication protocol testers.

Visual style: modern flat vector design, clean professional developer-tool
aesthetic, subtle gradient, crisp geometry, works at tiny favicon size.
Brand color: engineering blue (#1460d6 light / #1668dc dark). No photorealism,
no skeuomorphism, no cartoon mascot.
```

---

## 1.5 简洁版提示词（200 字以内，直接复制）

### 方向 A（推荐）寄存器网格 + 数据脉冲

```
Flat vector app icon, deep blue (#1460d6) rounded square. A 3x3 grid of
register table cells, bottom-center cell highlighted in white-blue, a soft
translucent data pulse radiating diagonally upward. Minimal geometric,
crisp, generous negative space, readable at 16px favicon. No text, no 3D,
no shadow, no photorealistic.
```

### 方向 B 数据插头 + 信号波纹

```
Flat vector app icon, deep blue (#1460d6) rounded square. A clean white data
connector plug in center emitting two concentric light-blue signal waves,
symbolizing Modbus polling. Minimal, symmetric, crisp geometry, negative
space, readable at 16px. No text, no 3D, no shadow.
```

### 方向 C 主从双节点通信链

```
Flat vector app icon, deep blue (#1460d6) rounded square. Two rounded nodes
(white + light blue) linked by a line with a bright cyan data packet between,
symbolizing Modbus master-slave communication. Minimal, symmetric, crisp,
readable at 16px. No text, no 3D, no shadow.
```

### 方向 D 「M」字母 + 寄存器单元格

```
Flat vector logo icon, deep blue (#1460d6) rounded square. Bold geometric
white "M" whose two legs are three register cells, center cell bright cyan,
fusing monogram with register table. Minimal, readable at 16px. No extra
text, no 3D, no shadow.
```

### 方向 E 数字波形 + 表格横线

```
Flat vector app icon, deep blue (#1460d6) rounded square. Thin horizontal
register-table lines overlaid by a bright cyan stepped digital waveform with
one glowing dot. Minimal, crisp geometry, readable at 16px. No text, no 3D,
no shadow.
```

---

## 2. 概念方向（每个方向含完整可直接用的提示词）

### 方向 A（推荐）：寄存器网格 + 数据脉冲

**概念**：一排整齐的寄存器单元格（代表寄存器表），其中一个单元格亮起并被一个向前传播的信号脉冲点亮——一眼传达「寄存器监控 + 数据流动」。

**中文描述**：扁平矢量应用图标，圆角方形（squircle）深蓝背景。前景是三行对齐的寄存器单元格（浅蓝描边的方形格），位于中下方的单元格高亮为白色/亮蓝，一个半透明的圆形信号脉冲从高亮格向斜上方扩散，像数据在表中流动。极简几何、留白充分，小尺寸可读。品牌蓝 #1460d6，高对比、无文字、无照片感。

**English prompt**：

```
Flat vector app icon, rounded-square (squircle) shape, deep engineering blue
background (#1460d6). In the center, a neat grid of register table cells —
3 columns by 3 rows of rounded squares with thin lighter-blue outlines.
The cell at bottom-center is highlighted in bright white-blue, and a soft
translucent circular data pulse radiates diagonally upward from it, implying
live data flowing through the register table. Minimal geometric composition,
generous negative space, crisp 45° angles, professional developer-tool
aesthetic, subtle flat gradient. High contrast, instantly readable at 16px
favicon size. No text, no photorealism, no skeuomorphism, no gradients mess.
```

**负向词**：`text, letters, watermark, photorealistic, 3d render, glossy, skeuomorphism, cartoon, cluttered, drop shadow`

---

### 方向 B：串口/网络插头 + 信号波纹

**概念**：一个数据插头（RTU 串口 / TCP 网口）与向外扩散的同心信号波纹，传达「连接 + 通信」。

**中文描述**：扁平矢量应用图标，圆角方形深蓝背景。前景中央一个简洁的白色数据插头图标（工业 RS-232/网络插头造型），插头尖端向外发出两到三层同心圆弧信号波纹（浅蓝到白色渐变），象征 Modbus 主站持续向设备轮询通信。几何极简、线条统一、居中构图、负空间充足。

**English prompt**：

```
Flat vector app icon, rounded-square (squircle) shape, deep engineering blue
background (#1460d6). Center: a clean minimal white data connector plug icon
(industrial serial/network port style, unified 2px stroke weight). From the
plug tip, 2–3 concentric arc signal waves radiate outward in light blue to
white gradient, symbolizing continuous Modbus master polling to devices.
Symmetric centered composition, generous negative space, crisp geometry,
professional developer-tool aesthetic, subtle flat gradient. Readable at
small size. No text, no photorealism, no skeuomorphism.
```

**负向词**：`text, letters, watermark, photorealistic, glossy, skeuomorphism, cartoon, cluttered, drop shadow, 3d render`

---

### 方向 C：主从双节点通信链

**概念**：两个圆角节点（主站 / 从站）之间一条通信链路与数据包，直接表达 Modbus 的主从请求-响应模型。

**中文描述**：扁平矢量应用图标，圆角方形深蓝背景。前景是两个圆角方块节点（一个白色、一个浅蓝），之间用一条短直线连接，链路中间有一个亮蓝色小方块「数据包」正在传输，配一小段箭头暗示方向。象征主站与从站设备之间的 Modbus 请求-响应通信。极简、对称、留白充足。

**English prompt**：

```
Flat vector app icon, rounded-square (squircle) shape, deep engineering blue
background (#1460d6). Foreground: two rounded-square nodes — one solid white,
one light blue — connected by a short horizontal link line. A small bright
cyan square "data packet" sits on the link with a subtle direction arrow,
representing the Modbus master-to-slave request/response communication.
Minimal symmetric composition, generous negative space, crisp geometry,
professional developer-tool aesthetic, subtle flat gradient. Readable at
small size. No text, no photorealism, no skeuomorphism.
```

**负向词**：`text, letters, watermark, photorealistic, glossy, skeuomorphism, cartoon, cluttered, drop shadow, 3d render`

---

### 方向 D：M 字母标记 + 寄存器单元格

**概念**：品牌字母「M」与寄存器表格元素融合，适合需要强品牌识别的场景（产品 Logo、VSCode 插件图标）。

**中文描述**：扁平矢量 Logo 图标，圆角方形深蓝背景。前景是一个几何化的白色字母「M」，M 的两条腿被处理成三格寄存器单元格（中间格高亮为亮蓝），把字母与「寄存器表」概念融合。字重统一、笔画几何化、极简居中。

**English prompt**：

```
Flat vector logo icon, rounded-square (squircle) shape, deep engineering blue
background (#1460d6). Foreground: a bold geometric white letter "M" whose two
legs are stylized as three stacked register-table cells, with the center cell
highlighted in bright cyan — fusing the brand monogram with the register table
concept. Uniform stroke weight, geometric construction, minimal centered
composition, generous negative space, professional developer-tool aesthetic,
subtle flat gradient. Readable at small size. No extra text, no photorealism,
no skeuomorphism.
```

**负向词**：`watermark, photorealistic, glossy, skeuomorphism, cartoon, cluttered, drop shadow, 3d render, extra letters`

---

### 方向 E：通信波形 + 表格横线

**概念**：一条连续的数字信号波形叠在寄存器表格的横线上，强调「协议/信号 + 表格数据」双语义，科技感强。

**中文描述**：扁平矢量应用图标，圆角方形深蓝背景。前景是几条水平细线（代表寄存器表格行），上面叠一条亮蓝色的折线数字波形（阶梯状方波，Modbus 数字信号感），波形起伏处有一个亮点。极简、横向构图、留白充足。

**English prompt**：

```
Flat vector app icon, rounded-square (squircle) shape, deep engineering blue
background (#1460d6). Foreground: several thin horizontal lines representing
register table rows, overlaid by a bright cyan stepped digital waveform
(square-wave staircase, digital signal feel) rising across them, with one
glowing dot at a step vertex. Minimal horizontal composition, generous
negative space, crisp geometry, professional developer-tool aesthetic,
subtle flat gradient. Readable at small size. No text, no photorealism,
no skeuomorphism.
```

**负向词**：`text, letters, watermark, photorealistic, glossy, skeuomorphism, cartoon, cluttered, drop shadow, 3d render`

---

## 3. 通用风格约束（所有方向共用，可追加到任意提示词末尾）

```
- App icon format, single central motif, no more than 3 visual elements
- Flat vector style with one subtle flat gradient (no glossy / no 3D / no drop shadow)
- Brand blue palette only: #1460d6 base, #1668dc dark, #69b1ff / #1677ff accent, white for contrast
- Unified stroke weight, geometric shapes, crisp 45° / 90° angles
- Deep blue background (#0d3a8f ~ #1460d6) with high-contrast foreground
- Generous negative space; shapes must remain recognizable at 16×16 px
- Absolutely no text, letters, watermarks, or UI chrome
- Professional engineering tool aesthetic, not consumer app, not cartoon
```

---

## 4. 各工具适配提示词

### 4.1 Midjourney

在方向 A 的 English prompt 末尾追加：

```
--ar 1:1 --style raw --v 6
```

完整示例：

```
Flat vector app icon, rounded-square shape, deep engineering blue background (#1460d6). In the center, a neat grid of register table cells — 3 columns by 3 rows of rounded squares with thin lighter-blue outlines. The cell at bottom-center is highlighted in bright white-blue, and a soft translucent circular data pulse radiates diagonally upward from it, implying live data flowing through the register table. Minimal geometric composition, generous negative space, crisp 45° angles, professional developer-tool aesthetic, subtle flat gradient. High contrast, instantly readable at 16px favicon size. No text, no photorealism, no skeuomorphism. --ar 1:1 --style raw --v 6
```

> 技巧：Midjourney 对「app icon」概念掌握较好；若结果偏圆润/卡通，追加 `--stylize 0`（更忠实于描述）。多跑几张从中挑选，再对满意的用 `--vary region` 局部微调。

### 4.2 DALL·E / GPT-4o / 图像模型（OpenAI）

直接使用方向 A~E 的完整 English prompt。DALL·E 对精确 hex 色号理解一般，可改为描述性色名并在负面强调 `no purple, no red`：

```
... Brand palette strictly blue family: deep royal blue background, cyan and
white foreground accents. NO purple, NO red, NO green. ...
```

### 4.3 Ideogram

Ideogram 擅长文字渲染，但我们**不需要文字**。直接使用完整 English prompt，并在末尾追加：

```
No text, no letters, no words, no watermark, no label.
```

### 4.4 Recraft（矢量输出，推荐用于最终落地）

Recraft 可输出 SVG/矢量，适合直接落地的图标。使用完整 English prompt，并把 Style 选为 **Flat / Line** 类，颜色模式选 **Duotone**（主色 #1460d6 + 强调 #1677ff）。Recraft 生成后可导出 SVG 再人工清理路径。

### 4.5 Stable Diffusion（SDXL）

**正向**：使用方向 A 的 English prompt 原文。

**负向（negative prompt）**：

```
text, letters, word, watermark, signature, photorealistic, photo, 3d render,
octane render, glossy, plastic, skeuomorphism, cartoon, chibi, mascot,
cluttered, busy, drop shadow, border, frame, purple, red, green, low quality,
blurry, jpeg artifacts, duplicate, extra fingers
```

**建议参数**：`Steps 30, CFG 7, Sampler DPM++ 2M Karras, Size 1024×1024`。
如装了 ICON 类 LoRA（如 icon-diffusion）可叠加提升 icon 形态稳定性。

---

## 5. 生成后的验收清单

生成结果请对照以下清单筛选 / 反馈给工具迭代：

- [ ] **小尺寸可读**：缩到 16×16 px 仍能看出核心图形（在浏览器标签页 / VSCode 侧栏不糊成一团）
- [ ] **单主体**：只保留 1 个视觉中心，元素不超过 3 个
- [ ] **配色正确**：蓝色系（#1460d6 家族），无杂色、无紫色/红色意外混入
- [ ] **无文字**：无字母、无水印
- [ ] **风格统一**：扁平矢量、无 3D/拟物/阴影、无卡通
- [ ] **深浅主题兼容**：深蓝背景版本在浅色任务栏/标题栏也清晰（必要时生成一版浅色背景变体）

### 落地尺寸参考

| 场景 | 尺寸 | 说明 |
| --- | --- | --- |
| 网页 favicon | 16 / 32 / 48 px | `apps/web/public/favicon.svg`（可替换为生成的 SVG） |
| PWA / 浏览器图标 | 192 / 512 px | `apps/web/public/` |
| Electron 应用图标 | 256 / 512 px（.png / .ico） | `apps/electron/build/`，打包配置见 `electron-builder.yml` |
| VSCode 扩展图标 | 128×128 px（.png） | `apps/vscode-extension/`，package.json `icon` 字段 |

---

## 6. 迭代话术（生成结果不理想时反馈给工具）

- 太复杂/太满 → *"Simplify to a single central motif, remove background details, more negative space."*
- 太卡通 → *"More geometric, sharper angles, professional engineering tool aesthetic, reduce roundness of shapes."*
- 颜色跑偏 → *"Strictly blue color palette only: hex #1460d6 background, cyan #1677ff and white accents. No purple, no red."*
- 有文字/水印 → *"Remove all text, letters and watermarks."*
- 想更贴产品 → *"Make the register grid cells and the data pulse the dominant elements."*
