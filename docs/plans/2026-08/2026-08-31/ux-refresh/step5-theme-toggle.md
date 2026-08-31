---
step: 5
title: 主题切换与变量重调
status: done
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
  1. 主题选项 UI 未用 shadcn RadioGroup 组件，而是复用设置页既有的「原生 radio + 卡片行」模式（与权限模式/消息显示模式同构），保持设置页视觉语言一致；语义同为三选一 RadioGroup。
  2. 多窗口同步除渲染层双源驱动外，还需把 `broadcastSettingsChanged` 从仅主窗口扩展到全部 BrowserWindow（计划验证项「数据中心/独立会话窗口同步」的必要条件，原链路只发主窗口）。
  3. `nativeTheme.themeSource` 同步点收敛在 `saveSettings()` 内（全部保存路径都过这里），而非仅 tipc settings 路由；另在启动 `whenReady` 中应用一次保重启记忆。
  4. 滚动条双态色改为变量驱动（`--scrollbar-thumb(-hover)`），修复了存量问题：原 `.dark`/`:root` 级联覆盖无法命中 html 自身滚动条。
- 改动文件清单：`src/globals.css`（两套变量重调 + 滚动条/selection 双态 + `.font-reading` 正文色）；`types/settings.ts` 与 `electron/main/services/settings-types.ts`（双端 appearance + ThemePreference + DEFAULT）；`electron/main/services/settings-service.ts`（applyThemeSource + saveSettings 挂钩 + normalizeSettings 校验）；`electron/main/index.ts`（启动应用主题 + 广播全窗口）；`lib/setup-settings-sync.ts`（applyTheme 双源驱动）；`app/settings/page.tsx`（主题三态选择）；`electron/main/services/settings-normalize.test.ts`（补 appearance 校验测试）。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `AppSettings.appearance?: { theme: 'light' | 'dark' | 'system' }`（双端类型同名同构，DEFAULT `'light'`）
  - 主进程 `applyThemeSource(theme: unknown): void`（electron/main/services/settings-service.ts，非法值回退 'light'，settings-service 已引 nativeTheme）
  - 渲染层 `applyTheme(theme, systemDark)`（lib/setup-settings-sync.ts）：`dark = theme === 'dark' || (theme !== 'light' && systemDark)`，toggle html 的 `.dark` class；settings store 订阅 + `matchMedia('change')` 双源
  - CSS 变量新增：`--reading-foreground`（亮 #4A453D / 暗 #AEB4BD）、`--scrollbar-thumb(-hover)`；对比度实测：亮 11.6:1 / 暗 9.6:1，reading 正文 8.4:1 / 7.5:1
- 下个 step 该从哪里继续：Step 6 清理硬编码色（notes-editor pre 背景 #0d1117、Step 4 差分红绿底 dark: 变体、minimap-flash 黄色等），墨蓝底上已有变量基建可依赖
- 待办或已知限制：
  - 暗色用户启动时有一瞬亮色闪烁（loadSettings 异步后才 toggle .dark）；如需消除可在 index.html 加 localStorage 预置脚本（本步未做）
  - chart 色两态一致未区分（数据可视化色保持可辨识性）；notes-editor pre 仍硬编码 GitHub dark 配色（Step 6 范围）
  - restartSessions=true 广播全窗口后，各窗口各自调 restartActiveSessions（主进程 closeAll 幂等，第二次 closedCount=0，无副作用）
