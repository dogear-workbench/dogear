# 依赖月度巡检 · 定时任务 Prompt

> 建任务时整段复制「prompt 正文」到任务编辑页的提示词输入框。

## prompt 正文

对本工作区（Dogear 项目）做依赖健康月度巡检，产出一张笔记卡片。按以下步骤执行：

## 1. 读取依赖清单

Read 工作区根目录的 `package.json`，收集 dependencies 与 devDependencies 全部条目（包名 + version range）。以 range 下限作为该包的「基线版本」。另读 `patches/` 目录名与 `patchedDependencies` 字段，记录哪些包带本地 patch。

## 2. 逐包查询 latest

按包名类型选数据源（不可混用其他源）：

- **非 scoped 包**（如 react、vite、zod）：bigmodel__webReader 抓 `https://registry.npmjs.org/-/package/<包名>/dist-tags`，取 JSON 里的 `latest` 字段
- **scoped 包**（如 @tiptap/react、@radix-ui/react-select）：registry 端点含 %2F 编码会被 webReader 拒绝，改抓 `https://www.npmjs.com/package/<scope>/<name>`，从返回内容的 description 里取 "Latest version: X" 的 X

纪律：

- 单包查询失败：记录「查询失败」，继续下一个，不中断巡检
- 查到的 latest 等于基线版本且该 range 长期未动时，标注「数据可能滞后（源有 1~2 天缓存）」，不断言「已最新」
- tiptap / react 系列 workspace 内是精确锁版，latest 高于锁定版不算异常，但仍如实记录差距

## 3. 分层

- **例行层**：latest 仍在 package.json range 范围内（patch/minor 落后）→ 一句话建议「可直接 bun update 批量升级 + 构建 + 冒烟」
- **立项层**：latest 超出 range 上限（major 跨越），或命中特殊规则：
  - `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`：带本地 patch，升级必须重新适配 patch，永远属立项层
  - `@tiptap/*`、`react`、`react-dom`：精确锁版，升级需回归测试，属立项层
  - `electron`：安全敏感（Chromium CVE），落后 2~3 个大版本内可接受，超出建议尽快立项
  - `node-pty`：native 模块，与 electron 版本耦合，必须跟 electron 同批升级
  - `@types/node`：跟随 electron 内置 Node 大版本评估

## 4. 对比上月

dogear__SearchNotes 按标签「依赖巡检」查询，取最近一张（非本次待写的），dogear__GetNote 读全文，对比：新落后的包（上月 latest 未超 range、本月超了）、已追上的、立项层评估变化。查不到历史卡片则记「首次巡检」。

## 5. 落巡检卡片

dogear__CreateNote 创建新卡片，tags: `["依赖巡检"]`，正文结构：

```
# 依赖巡检 YYYY-MM

## 概览
依赖总数 / 例行层 N 个 / 立项层 M 个；例行层给一条可执行的批量升级建议

## 例行层明细
表：包名 | 基线 | latest

## 立项层清单
逐包一行：包名 | 基线 | latest | 评估（值得尽快立项 / 可缓 / 数据不足）+ 一句理由
electron 单独标注当前落后几个大版本

## 与上月变化
新落后 / 已追上 / 评估变化；首次巡检则说明

## 备注
部分数据源有 1~2 天缓存滞后；精确核对请在主会话跑 bun outdated
```

完成后输出结果自述（做了什么、卡片 id、异常包列表）。
