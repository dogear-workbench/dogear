# 全局字体大小三档设置 设计

**背景**：用户反馈整体字体偏小。现霞鹜文楷仅用于文章预览区（`font-reading`），UI 其余部分为系统字体。需要一个全局字体大小设置，且霞鹜文楷全局应用于整个 UI。

**目标**：
1. 设置页「基础设置」提供界面大小三档：小（100%，现状）/ 中（120%，默认）/ 大（135%）
2. 霞鹜文楷全局应用：`--font-sans` 文楷打头，标题中文回退文楷；代码/终端保留等宽
3. 所有窗口（主窗口 + 设置/数据中心/自选股/独立会话等子窗口）同步生效

**架构**：
- 缩放机制用 **CSS root font-size**（`document.documentElement.style.fontSize`），不用 Electron zoomFactor——canvas 图表不糊、渲染层一个订阅搞定、Tailwind rem 体系整体缩放（文字、间距、图标尺寸）
- 已有跨窗口同步链路复用：设置保存 → 主进程广播 `settingsChanged` → 各窗口 `setupSettingsSync` 重新 loadSettings。fontSize 应用逻辑挂在 `setup-settings-sync.ts`，启动时主动 loadSettings 一次（不依赖页面自己加载），再订阅 settings 变化应用字号
- 排除 zoomFactor：会缩放 canvas 导致图表模糊，且需逐窗口主进程处理

**模块边界**：
- `types/settings.ts`：`AppSettings.ui.fontSize?: 'small' | 'medium' | 'large'`（可选，旧数据缺省回落 medium）；`DEFAULT_SETTINGS.ui.fontSize: 'medium'`
- `src/globals.css`：`--font-sans: "LXGW WenKai", system-ui, ...`；`--font-display: Georgia, "LXGW WenKai", ...`
- `lib/setup-settings-sync.ts`：启动 loadSettings + 订阅应用 `document.documentElement.style.fontSize`
- `app/settings/page.tsx`：基础设置 tab 加「界面大小」segmented control（沿用 effort 档位组件样式）

**数据流**：用户切换档位（local 草稿）→ 点保存 → `client.updateSettings` → 主进程落盘并广播 → 各窗口 loadSettings → store 更新 → 订阅回调设置 root font-size → rem 体系整体缩放。

**错误处理 / 边界情况**：
- 旧 settings 无 `ui.fontSize`：读取时 `?? 'medium'`，中档即默认
- `text-[13px]` 等 72 处 px 硬编码不随档位缩放（已确认可接受）
- xterm / canvas 图表字号不缩放（符合「图表不糊」预期）
- 设置页为草稿+保存模式，fontSize 跟随该模式（不即时生效，避免绕过保存按钮把其他草稿一并落盘）

**未决问题**：无（三档已实测调优为 100/120/135）。
