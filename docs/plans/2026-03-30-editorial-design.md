# Dogear 编辑室风格 UI 重设计

## 设计方向

**编辑室风格 (Editorial Style)** —— 杂志排版美学、大胆字体对比、高对比度暗色主题。

## 字体系统

| 用途 | 英文 | 中文 | CSS 变量 |
|------|------|------|----------|
| 显示/标题 | Playfair Display | Noto Serif SC | `--font-display` |
| 正文/UI | DM Sans | Noto Sans SC | `--font-sans` |
| 等宽/代码 | JetBrains Mono | — | `--font-mono` |

## 色彩方案（暗色主题优先）

### 暗色主题（主要）
```
背景层：
  #0C0C0C — body 最深背景
  #161616 — 卡片/面板
  #1E1E1E — 输入框/提升层
  #2A2A2A — 边框/分隔线

文字层：
  #EDEBE8 — 主文字（微暖白）
  #9A9590 — 次要文字
  #5C5955 — 占位/禁用

强调色：
  #E8590C — 燃烧橙（主强调）
  #FF6B1A — hover 态
  #C24A0A — pressed 态

功能色：
  #E5484D — 错误/破坏
  #30A46C — 成功
  #3B82F6 — 信息/链接
```

### 亮色主题（后续补充）
暂保留基础变量，后续单独优化。

## 全局样式

- 滚动条：6px 宽，圆角，暗色融入背景
- 文字选中：橙色高亮
- 分隔线：2px 粗线可选（`border-editorial`）
- 抗锯齿：保持 antialiased

## 改动范围

1. `index.html` — 字体引入
2. `src/globals.css` — 色彩变量 + 全局样式
3. `src/App.tsx` — 默认 dark class
