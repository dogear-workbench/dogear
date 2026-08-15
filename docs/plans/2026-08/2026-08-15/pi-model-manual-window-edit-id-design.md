# PI 模型手填上下文窗口与行内改 ID 设计

**背景**：pi-ai 静态模型目录收录滞后（如 glm-5.3 未收录），未识别 ID 回落 200K 导致自动压缩提前触发、usage 徽章窗口失真。另外模型退役换新（glm-5.2 → glm-5.3）目前只能删除重加，丢失显示名与排序。

**目标**：
1. 模型清单条目可手填上下文窗口，优先级「手填 > pi-ai 目录 > 200K 回落」
2. 模型 ID 行内可直接编辑，不用删除重加

**架构**：
- `piModels` 条目扩展为 `{ id: string; label?: string; contextWindow?: number }`，可选字段零迁移
- 窗口解析在主进程 3 个读取点统一感知手填值；`services/usage/usage-extractor.ts`（SDK 历史导入，无 profile 上下文）保持纯查表不动
- 渲染层 usage 徽章读的是主进程落库的 entry.contextWindow，主进程带手填值后自动正确，零改动

**模块边界**：
- `electron/main/services/settings-types.ts` —— piModels 条目类型加 `contextWindow?: number`
- `electron/main/services/settings-service.ts` —— `normalizePiModels` 白名单放行「正整数」的 contextWindow（否则每次启动读设置时手填值被洗掉），去重/非法丢弃逻辑维持现状
- `electron/main/agents/pi/provider.ts` —— `buildPiModel` 签名改为传条目对象（现为 `(profile, id, label)`），`contextWindow: entry.contextWindow ?? lookupCatalogEntry(id)?.contextWindow ?? FALLBACK`；`resolvePiModel` / `buildPiModels` 调用点同步。自动压缩阈值经 `pi-session.ts` 的 `currentContextWindow = model.contextWindow` 自然继承
- `electron/main/agents/pi-session/usage-extractor.ts` —— `extractPiUsageEntry` 加可选窗口解析器参数（默认纯查表），`pi-session.ts` 的 `emitUsageEntry` 调用时传「先查该 profile 手填、再查表」的版本
- `app/settings/page.tsx` —— 模型行 UI：
  - ID 格从只读 span 改输入框；trim 后为空或与清单内其他 id 重复时拒绝保存回退原值（重复会导致 `find` 歧义）
  - 窗口徽标点击进入编辑，输入支持 `1M` / `200K` / `1000000`；Enter/失焦保存，清空 = 删除手填恢复查表，ESC 取消；手填生效的徽标带「手动」标记
  - 显示名输入框、删除按钮不变
- `lib/pi-model-catalog.ts` —— 渲染层加 `resolveModelWindow`（entry 手填 ?? 查表）与 `parseContextInput`（K/M 简写解析）辅助

**数据流**：
- 手填：设置页输入 → updateProfileField 落 piModels → 主进程读设置时 normalizePiModels 保留 → provider 构造 Model / usage 提取 / 渲染层徽标三处解析生效
- 改 id：设置页输入 → piModels 条目 id 更新（label/contextWindow 保留）→ 下条消息 resolvePiModel 用新 id 发请求

**错误处理 / 边界情况**：
- 改 id 后存量对话 `tier` 仍存旧 id，发消息走 `provider.ts` 现有 throw「模型不在清单里」，用户手动重选（与删除模型行为一致，已拍板不迁移）
- 手填窗口对目录已识别的模型同样生效（可覆盖目录值，如目录滞后或上游实际放量不同）
- `parseContextInput` 非法输入（非数字 / 非 K M 后缀）不生效，保持原值
- extractPiUsageEntry 的 resolver 未传时行为与现状完全一致（历史导入等场景）

**未决问题**：无（关键分歧「存量对话兜底」已拍板 A：报错重选）
