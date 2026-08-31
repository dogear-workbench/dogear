---
step: 5
title: 主题切换与变量重调
status: pending
---

## 目标
两套阅读优先配色（暖纸亮/墨蓝暗，对比度 ~10:1）+ 亮/暗/跟随系统三态开关，多窗口同步与原生标题栏联动。

## 依赖上下文（接力棒输入）
- 前置 step 产出：（执行后回填）
- 当前关键文件状态：`src/globals.css` `:root` 亮色（#FAF9F6 底/#1A1A1A 字）与 `.dark`（#0C0C0C 底/#EDEBE8 字）**两套都将重调**；`@custom-variant dark (&:is(.dark *))` 已配置；`types/settings.ts` AppSettings + DEFAULT_SETTINGS；设置广播 `broadcastSettingsChanged` 链路已有（`lib/setup-settings-sync.ts` 渲染层收 settingsChanged 重拉）
- 关键决策回顾：阅读舒适区 7~11:1，亮色根因是 #1A1A1A on 米白 ~16:1 对比过高；暗色弃纯黑（光晕效应）。主色燃烧橙保留，暗色下可微亮化。字体不动。

## 计划改动
- [ ] `src/globals.css` 重调两套变量（卡片/边框/secondary/muted 等全套跟随主基调推导，不止 background/foreground 四个）：
  - 暖纸亮：background `#F6F1E7` / foreground `#33302B` / card `#FCF9F2` / popover `#FCF9F2` / secondary+muted 暖灰 / border 暖调
  - 墨蓝暗：background `#1E242C` / foreground `#C6CBD2` / card `#252C36` / popover `#252C36` / border `#343D49` / muted-foreground 蓝灰 `#7E8894`
  - 主色暗色微亮化（如 `#F06A1F`，目测定稿）；`.font-reading` 正文色局部再降一档对比（亮暗各配）
  - 滚动条/selection 等 base 层双态色同步新基调
- [ ] `types/settings.ts`：AppSettings 平级加 `appearance: { theme: 'light' | 'dark' | 'system' }`（DEFAULT_SETTINGS 给 'light'；主进程默认值结构对齐，找 `electron/main/` 下 settings 读写点同步）
- [ ] 渲染层应用：`lib/setup-settings-sync.ts` 或新 setup 函数——loadSettings/matchMedia 双源驱动 `document.documentElement.classList.toggle('dark', effectiveDark)`；system 模式监听 `matchMedia('(prefers-color-scheme: dark)')` 变化
- [ ] 主进程：settings 保存路径上调 `nativeTheme.themeSource = 'light' | 'dark' | 'system'`（管系统跟随 + 标题栏深浅）；涉及主进程改动需 `bun run build:electron`
- [ ] `app/settings/page.tsx` 基础设置 tab 加主题三态选择（RadioGroup 三项：亮色/暗色/跟随系统）
- [ ] 验证：三态切换即时生效；数据中心独立窗口/独立会话窗口同步；标题栏颜色跟随；重启后记忆

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
