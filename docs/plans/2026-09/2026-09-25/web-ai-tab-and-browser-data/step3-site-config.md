---
step: 3
title: 站点配置管理
status: done
---

## 目标

`webAiSites` 从预置默认值升级为用户可管理：settings schema 落地 + 设置页增删改编辑 UI，白嫖 tab 切换器实时联动。

## 依赖上下文（接力棒输入）

（待 Step 2 回填：切换器当前读 settings 的方式、webAiSites 的运行时消费点。）

已知：
- settings.json 在应用数据目录（`.dogear/settings.json`），读写走主进程 settings service；执行时 Grep `webAiSites` 相关代码看 Step 2 留下的默认值位置
- 设置页结构参考 `docs/codebase-map/settings.md`（执行时读，找合适的 section 挂载编辑 UI）

## 计划改动

- [x] settings schema/类型 — `webAiSites: [{id, name, url}]` 进 settings 类型定义（前后端共享类型位置执行时确认），默认值预置 DeepSeek/Kimi/豆包
- [x] 设置页 — 「网页 AI 站点」编辑 UI：列表（名称+URL）+ 新增/删除/编辑行；URL 需 http(s) 校验，至少保留 1 条不可全删
- [x] 白嫖 tab 切换器 — 从 settings 动态读列表，设置变更后刷新（settings 变更事件机制执行时确认）
- [x] 站点被删/当前站点不在列表时的兜底（切到列表第一项）

## 验证

- 设置页增/删/改站点，白嫖 tab 切换器实时反映
- 删掉当前正在看的站点，tab 兜底切到列表第一项
- 重启后配置保留

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - URL http(s) 校验只做设置页 UI 层红字提示（不阻塞防抖落盘），normalize 层只拦截结构性非法（非对象/缺 id·name·url）——若 normalize 也拦 http(s) 会与设置页防抖写回互搏（关页时写回非法值→下次读又被删）
  - 「站点被删」判定基于 selectedSiteId（用户选中的站点 id）而非 URL 前缀匹配，避免 snapshot 深链展示（matchSiteUrl 匹配不上）时误跳
  - 主进程 webai.ts 采取「模块加载时 loadSettings 预热首项」方案（非渲染层首传）：DEFAULT_WEB_AI_URL 删除，webaiUrl 初始值改引 DEFAULT_WEB_AI_SITES[0].url，读盘后覆写为用户配置首项；openWebAiSite 每次仍以实际 url 覆盖，无需监听 settings 变更
- 改动文件清单：
  - types/settings.ts — WebAiSite 接口 + DEFAULT_WEB_AI_SITES + AppSettings.webAiSites? + DEFAULT_SETTINGS 补默认值
  - electron/main/services/settings-types.ts — 同形类型 + DEFAULT_WEB_AI_SITES + normalizeWebAiSites 纯函数
  - electron/main/services/settings-service.ts — normalizeSettings 接入 normalizeWebAiSites（清洗后空列表回默认三项）
  - app/settings/WebAiSitesSection.tsx — 新增：站点增删改编辑 UI（名称+URL 行内编辑、URL 红字校验、至少保留一条）
  - app/settings/page.tsx — 基础设置 tab「浏览器」小节后挂载 WebAiSitesSection
  - components/webai/WebAiPanel.tsx — 删 WEB_AI_SITES 硬编码，改 useSettingsStore 订阅 webAiSites（settingsChanged 自动刷新），新增 selectedSiteId 兑底 effect
  - electron/main/services/browser/embedded/webai.ts — 删 DEFAULT_WEB_AI_URL，模块加载时预热首项

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `WebAiSite = { id: string; name: string; url: string }`，双份定义：types/settings.ts（渲染层）与 electron/main/services/settings-types.ts（主进程），改 schema 两处同步
  - `DEFAULT_WEB_AI_SITES` 预置 deepseek/kimi/doubao 三项，id 固定（编辑不换 id，删了重加才换 uuid）；预置 id 与用户配置列表共享同一命名空间
  - 切换器联动机制：设置页防抖 500ms 落盘 → updateSettings → broadcastSettingsChanged → setup-settings-sync → settings-store.loadSettings → WebAiPanel 订阅刷新，无需新增 IPC
- 下个 step 该从哪里继续：Step 4 数据中心浏览器数据面板；webAiSites 运行时消费点仅剩 WebAiPanel（切换器）与 webai.ts（webaiUrl 兑底）两处
- 待办或已知限制：
  - 编辑（非删除）当前打开站点的 URL 不会自动跟随，需用户手动点按钮切换
  - URL 非法时照常落盘（UI 红字提示），点击切换器会由 webai.ts loadURL catch 兑底（打日志不崩）
  - 主进程 webaiUrl 预热只在模块加载时读一次 settings，之后完全跟随 openWebAiSite 传参，无需实时跟踪设置变更
