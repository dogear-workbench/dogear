---
step: 1
title: 设置层 + 设置页 failover 配置
status: done
---

## 目标

failover 配置可落盘、可 normalize 自愈、可在设置页编辑（开关 + 供应商链列表 + 模型下拉 + 排序）。

## 依赖上下文（接力棒输入）

- 设计依据：`../model-failover-design.md` 「设置层」一节 + plan.md 全局决策的数据结构/normalize 行为
- 当前关键文件状态：
  - `electron/main/services/settings-types.ts`：`AppSettings` 接口（~L70-90），`subAgent: { profiles: SubAgentProfile[] }` 之后加 `failover?`
  - `electron/main/services/settings-service.ts`：normalize 函数尾部在 L195-254（subAgent 段），failover normalize 挂同函数
  - `types/settings.ts`：前端镜像类型 + `DEFAULT_SETTINGS`
  - `app/settings/page.tsx`：设置主页，供应商配置区就在此文件（含 `PiModelRow`、`ModelSelector` 引用）；tab 结构为 Tabs
  - `stores/settings-store.ts`：设置读写现有机制，直接复用保存通道
- 关键决策回顾：链以供应商为单位每家一条（「多个模型也没用」）；新增供应商追加链尾；failover 缺失时按现有 profiles 顺序生成完整链（enabled: false，用户自己开）——让用户打开设置页即可见完整链直接启用

## 计划改动

- [x] `electron/main/services/settings-types.ts`：`FailoverEntry { profileId: string; tier: string }`、`FailoverConfig { enabled: boolean; chain: FailoverEntry[] }`、AppSettings 加 `failover?: FailoverConfig`；`normalizeFailoverChain(profiles: Record<string, ModelProfile>, failover: FailoverConfig | undefined): FailoverConfig` 纯函数（追加/移除/回退/去重/缺失生成）
- [x] `electron/main/services/settings-service.ts`：normalize 主函数调用 `normalizeFailoverChain`（profiles 与 subAgent 段同函数内，profiles 可直接拿到）
- [x] `types/settings.ts`：镜像 `FailoverEntry`/`FailoverConfig` + `DEFAULT_SETTINGS.failover = { enabled: false, chain: [] }`
- [x] `app/settings/page.tsx`：AI 设置 tab 供应商区之后加「模型故障转移」区块——
  - 总开关（Switch，「费率错误时自动切换供应商继续」）
  - 链列表：每行 = 供应商名 + 模型下拉（Select，选项 = 该 profile 的 `piModels`，显示 label 缺省 id）+ 上移/下移按钮（ArrowUp/ArrowDown 图标）+ 行序号
  - 空链/单供应商时给说明文案（「至少配置两家供应商才能故障转移」）
  - 底部说明：新供应商自动追加到列表末尾；链走完仍失败将停止会话并报错
  - 编辑走 settings-store 现有 set/保存路径（与供应商编辑同款 deepEqual 变更检测）
- [x] 验证：`bun run lint` 0 errors；`bun run build:electron`；前端 `bunx tsc --noEmit` 零新增错误；dev 手动走查——开关/选模型/排序落盘 `.dogear/settings.json`、新增供应商重启后追加链尾、删供应商重启后移出链、tier 失效回退

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 「模型故障转移」区块抽为独立组件 `app/settings/FailoverSection.tsx`（沿用 BasicToolsSection 的 local/setLocal 模式），在 page.tsx 挂载，避免 page.tsx 进一步膨胀
  - 链成员规则收紧：piModels 为空的供应商不进链/被移出链（否则默认设置每次 load 都会落盘写入无意义条目，破坏幂等；无法提供 tier 的供应商对 failover 无用）
  - 模型下拉用原生 `<select>`（项目内无 Radix Select 组件，settings 页既有惯例即原生 select）
  - tier 失效时 UI 显示「（已失效，重载设置后回退）」占位选项而非空白
  - 主进程 DEFAULT_SETTINGS 也加了 failover 默认值（计划只提了前端，两侧一致避免 deepMerge 分歧）
- 改动文件清单：
  - `electron/main/services/settings-types.ts`：FailoverEntry/FailoverConfig 类型、AppSettings.failover?、DEFAULT_SETTINGS.failover、normalizeFailoverChain 纯函数（含 string[] 旧形状 piModels 兼容）
  - `electron/main/services/settings-service.ts`：normalizeSettings 尾部接入 normalizeFailoverChain，JSON.stringify 变更检测
  - `types/settings.ts`：镜像类型 + DEFAULT_SETTINGS.failover
  - `app/settings/FailoverSection.tsx`（新增）：开关 + 链列表（序号/供应商名/模型下拉/上移下移）+ 空链与单供应商文案 + 底部说明
  - `app/settings/page.tsx`：「模型方案」tab 供应商区之后挂载 FailoverSection
  - `electron/main/services/settings-normalize.test.ts`：新增 11 个 failover normalize 测试（43/43 pass）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `FailoverEntry = { profileId: string; tier: string }`；`FailoverConfig = { enabled: boolean; chain: FailoverEntry[] }`；`AppSettings.failover?: FailoverConfig`（主/前端两侧同形）
  - `normalizeFailoverChain(profiles: Record<string, ModelProfile>, failover: FailoverConfig | undefined): FailoverConfig`（settings-types.ts 导出，worker 安全，纯函数）
  - step2 可直接 `settings.failover` 读链（loadSettings 已 normalize，必然存在且自愈）
- 下个 step 该从哪里继续：设计文档「Failover 核心逻辑」新模块 `electron/main/agents/model-failover.ts`（findNextFailover + 续跑提示词）
- 待办或已知限制：
  - UI 编辑期（未保存/未重载）链可能短暂含已删供应商条目，渲染时已过滤，落盘后 normalize 自愈
  - 「新增供应商追加链尾」发生在下次 loadSettings（重启或重开设置页），非实时
