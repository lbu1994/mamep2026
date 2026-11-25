# 现代 CSS 布局指南 (CSS Modern Layouts)

## 用途说明
涵盖 CSS Grid、Flexbox 和响应式设计的完整实战指南，帮助掌握最新 CSS 布局技术，实现从简单到复杂的各种页面布局。

## 核心布局技术

### 1. Flexbox — 一维布局

```css
/* Flexbox 核心属性 */
.flex-container {
  display: flex;
  flex-direction: row;      /* row | column | row-reverse | column-reverse */
  flex-wrap: wrap;          /* nowrap | wrap | wrap-reverse */
  justify-content: center;  /* flex-start | center | flex-end | space-between | space-around | space-evenly */
  align-items: center;      /* stretch | center | flex-start | flex-end | baseline */
  gap: 16px;                /* 子元素间距 */
}

.flex-item {
  flex: 1;                  /* flex-grow flex-shrink flex-basis 缩写 */
  align-self: center;       /* 单独对齐 */
  order: -1;                /* 排序 */
}
```

#### Flexbox 实战：导航栏
```css
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.nav-links {
  display: flex;
  gap: 2rem;
  list-style: none;
}

.nav-links a {
  text-decoration: none;
  color: #333;
  font-weight: 500;
  transition: color 0.2s;
}

.nav-links a:hover {
  color: #3b82f6;
}
```

### 2. CSS Grid — 二维布局

```css
/* Grid 核心属性 */
.grid-container {
  display: grid;
  grid-template-columns: repeat(3, 1fr);    /* 3列等宽 */
  grid-template-rows: auto 1fr auto;         /* 行定义 */
  gap: 24px;                                  /* 间距 */
  
  /* 高级：命名区域 */
  grid-template-areas: 
    "header  header  header"
    "sidebar content content"
    "footer  footer  footer";
}

/* 使用命名区域 */
.header  { grid-area: header; }
.sidebar { grid-area: sidebar; }
.content { grid-area: content; }
.footer  { grid-area: footer; }
```

#### Grid 实战：圣杯布局
```css
.holy-grail {
  display: grid;
  grid-template-columns: 250px 1fr 200px;
  grid-template-rows: auto 1fr auto;
  grid-template-areas: 
    "header header header"
    "nav    main   aside"
    "footer footer footer";
  min-height: 100vh;
  gap: 0;
}

.holy-grail header { grid-area: header; }
.holy-grail nav    { grid-area: nav; }
.holy-grail main   { grid-area: main; }
.holy-grail aside  { grid-area: aside; }
.holy-grail footer { grid-area: footer; }
```

### 3. 响应式设计

```css
/* 移动优先，断点增强 */
.card-grid {
  display: grid;
  grid-template-columns: 1fr;            /* 手机：1列 */
  gap: 16px;
  padding: 16px;
}

/* 平板：2列 */
@media (min-width: 640px) {
  .card-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
    padding: 24px;
  }
}

/* 桌面：3列 */
@media (min-width: 1024px) {
  .card-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
    padding: 32px;
    max-width: 1200px;
    margin: 0 auto;
  }
}

/* 大屏：4列 */
@media (min-width: 1536px) {
  .card-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
```

### 4. 高级：瀑布流布局
```css
/* 使用 CSS Columns 实现瀑布流 */
.masonry {
  column-count: 3;
  column-gap: 20px;
}

.masonry-item {
  break-inside: avoid;
  margin-bottom: 20px;
}

/* 使用 Subgrid（更高级） */
.masonry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.masonry-grid > * {
  grid-row: span var(--span);  /* JS 动态计算高度 */
}
```

### 5. 实战：仪表盘布局
```css
.dashboard {
  display: grid;
  grid-template-columns: 280px 1fr;
  grid-template-rows: 64px 1fr;
  grid-template-areas: 
    "sidebar header"
    "sidebar main";
  height: 100vh;
}

.dashboard-header {
  grid-area: header;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid #e5e7eb;
}

.dashboard-main {
  grid-area: main;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 24px;
  padding: 24px;
  overflow-y: auto;
}
```

## 响应式设计原则
1. **移动优先**：先写手机端样式，再用 `@media (min-width: ...)` 增强
2. **相对单位**：使用 rem/em/%/vw/vh 替代 px
3. **流式布局**：flex-wrap + 百分比宽度
4. **内容驱动**：`minmax()` 让内容决定列宽

## 使用方法
```
使用 css-modern-layouts 技能，创建一个响应式的卡片网格布局，大屏4列，平板2列，手机1列。
帮我用Grid实现一个圣杯布局后台管理系统。
用Flexbox设计一个水平居中、垂直居中的登录表单。
```

## 最佳实践
1. 一维用 Flexbox，二维用 Grid
2. 用 `gap` 替代 `margin` 控制间距
3. 使用 `auto-fit`/`auto-fill` 实现自适应列数
4. 命名 grid areas 提高可读性
5. 善用 `minmax()` 设置合理尺寸范围
