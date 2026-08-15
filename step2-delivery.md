# step 2: 设置页模型行 UI

## 实际改动清单（文件 + 关键签名/props）

### `types/settings.ts`
- `ModelProfile.piModels` 类型同步扩展（与主进程 step1 对齐）：
  ```ts
  piModels?: Array<{ id: string; label?: string; contextWindow?: number }>;
  ```
  字段注释更新为「contextWindow 为手填生效窗口，优先于目录查表」。

### `lib/pi-model-catalog.ts`
新增两个纯函数：
```ts
export function resolveModelWindow(entry: { id: string; contextWindow?: number }): number {
  return entry.contextWindow ?? lookupContextWindow(entry.id) ?? FALLBACK_CONTEXT_WINDOW;
}

export function parseContextInput(input: string): number | undefined
```
- `parseContextInput`：正则 `^(\d+(?:\.\d+)?)([kKmM]?)$` 匹配 trim 后输入，K=×1000、M=×1e6、无后缀按原值；`Math.round` 取整，非正数/非法格式返回 `undefined`
- 实测：`'1M'`/`'1m'`/`'1.5M'`/`'200K'`/`'200k '`/`'1000000'`/`'262144'`/`'0.5K'`→500 全部正确；`'0'`/`'-5'`/`'abc'`/`''`/`'1.2.3'` → undefined

### `app/settings/pi-model-row.tsx`（新建，~170 行）
导出：
```ts
export interface PiModelEntry { id: string; label?: string; contextWindow?: number }
export function PiModelRow({ entry, others, onChange, onRemove }: {
  entry: PiModelEntry;
  others: PiModelEntry[];          // 同清单其他条目，ID 查重用
  onChange: (next: PiModelEntry) => void;
  onRemove: () => void;
})
```
行内四个控件：
- **ID 编辑框**（flex-1 font-mono）：受控 input + `idDraft` 本地草稿；blur/Enter 提交——trim 后为空或与 `others` 重复则回退原值并短暂标红 border（destructive，1.5s 自动消退）；变更成功调 `onChange` 整条更新（label/contextWindow 随条目保留）；ESC 回退草稿
- **窗口徽标**（三态 button）：手填 → 蓝色 `1M · 手动`；目录识别 → 灰色 `204.8K`；未识别未手填 → 黄色 `200K · 未识别`。点击进入编辑态（w-28 小 input，预填手填原值或空，placeholder `1M / 200K / 262144`）：Enter/blur 提交（非空且合法 → 写 contextWindow；清空 → 删 contextWindow 字段恢复查表；非法 → 回退不生效）；ESC 取消（`windowCancelled` ref 防 ESC 后 blur 双触发）
- **label 输入框**（w-44）：沿用现有受控逻辑，清空删字段，placeholder 跟随当前 id
- **删除按钮**：ghost + Trash2，调 `onRemove`
- 内部 `buildEntry(id, label?, contextWindow?)` 工厂按需组装字段，undefined 不写入 key（JSON 干净、dirty 检测准确）

### `app/settings/page.tsx`
- 模型清单 map 处（原 :509-554 约 46 行内联渲染）替换为 `<PiModelRow>` 接线（约 15 行）：`others` 传同清单其余条目，`onChange` 里 `updateProfileField(id, { piModels: map 定位替换 })`，`onRemove` 过滤删除
- 自动压缩阈值提示（原 :630 IIFE）：改用 `resolveModelWindow(first)` 展示生效窗口（手填优先）；未识别且未手填的尾注由「首模型未识别，按 200K 估算」改为「首模型未识别按 200K 估算，可在模型行点击窗口徽标手填」
- 模型清单区块说明文案同步提及窗口徽标可手填
- import 更新：`FALLBACK_CONTEXT_WINDOW` 移除、`resolveModelWindow` 新增、`PiModelRow` 引入
- 净效果：page.tsx 约 740 → 705 行

## 与计划的差异

- 无功能差异。三处实现细节补充：
  1. 徽标三态展示直接取 `entry.contextWindow` / `catalogWindow` / `FALLBACK_CONTEXT_WINDOW` 分支而非统一走 `resolveModelWindow`（组件内无未使用变量，page.tsx 提示文案处使用 `resolveModelWindow`）
  2. 窗口编辑 ESC 加 `windowCancelled` ref 防护，避免取消语义被 blur 提交覆盖
  3. `buildEntry` 工厂保证 onChange 产出的条目不带 undefined 字段（label 清空删字段的现有行为一并迁入）

## 验证命令输出摘要

| 命令 | 结果 |
|------|------|
| `bun run lint` | ✅ 0 error（74 warning 全部为存量 `types/`、`lib/events.ts` 等 no-explicit-any，非本次引入） |
| `bun run build` | ✅ exit 0（Vite 前端 `✓ built in 21.65s` + Electron 主进程 tsc 通过） |
| `bun -e` 行为验证 | ✅ parseContextInput 15 个用例全符合预期；resolveModelWindow 手填/查表/兜底三链路正确 |

真机 `bun run dev` 交互验证（glm-5.3 徽标编辑、ID 回退、usage 徽章按 1M 计算、存量对话旧 id 报错重选）未在本 step 执行，验证清单保留在 step2-settings-ui.md「验证」段待人工过一遍。

## 遗留问题

- 无功能性遗留。两个注意点：
  - ID 编辑提交依赖父级 `key={model.id}`，id 变更即重建组件、草稿自动重置（当前行为正确；若未来 map 改用 index key 需补草稿同步 effect）
  - 存量对话 tier 存旧 id → 发消息走现有 throw「模型不在清单里」，用户手动重选（全局已拍板，无迁移）
