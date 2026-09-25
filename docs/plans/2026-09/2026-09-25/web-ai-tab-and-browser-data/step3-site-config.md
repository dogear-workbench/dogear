---
step: 3
title: 站点配置管理
status: pending
---

## 目标

`webAiSites` 从预置默认值升级为用户可管理：settings schema 落地 + 设置页增删改编辑 UI，白嫖 tab 切换器实时联动。

## 依赖上下文（接力棒输入）

（待 Step 2 回填：切换器当前读 settings 的方式、webAiSites 的运行时消费点。）

已知：
- settings.json 在应用数据目录（`.dogear/settings.json`），读写走主进程 settings service；执行时 Grep `webAiSites` 相关代码看 Step 2 留下的默认值位置
- 设置页结构参考 `docs/codebase-map/settings.md`（执行时读，找合适的 section 挂载编辑 UI）

## 计划改动

- [ ] settings schema/类型 — `webAiSites: [{id, name, url}]` 进 settings 类型定义（前后端共享类型位置执行时确认），默认值预置 DeepSeek/Kimi/豆包
- [ ] 设置页 — 「网页 AI 站点」编辑 UI：列表（名称+URL）+ 新增/删除/编辑行；URL 需 http(s) 校验，至少保留 1 条不可全删
- [ ] 白嫖 tab 切换器 — 从 settings 动态读列表，设置变更后刷新（settings 变更事件机制执行时确认）
- [ ] 站点被删/当前站点不在列表时的兜底（切到列表第一项）

## 验证

- 设置页增/删/改站点，白嫖 tab 切换器实时反映
- 删掉当前正在看的站点，tab 兜底切到列表第一项
- 重启后配置保留

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
