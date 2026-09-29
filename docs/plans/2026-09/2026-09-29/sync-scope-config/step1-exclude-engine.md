# Step 1: 排除引擎与对称过滤

## 目标

建立可配置排除的唯一判定入口 `isExcluded(relPath, excludes)`，并在清单生成、拉取、应用三处对称接入；bump 协议版本。本步完成后，排除行为可由代码级 options 驱动（Step 2 再接通设置链路）。

## 改动

### 1. `sync/manifest.ts`

- `ManifestOptions` 增加可选字段：
  ```ts
  excludes?: {
    conflictCopies: boolean;   // false = 排除 .conflict-*
    shadowGit: boolean;        // false = 排除 shadow-git/ 目录
    disabledItems: Set<string> // SyncItemId 集合（'workspaces' | 'conversations' | ... | 'settings.json' | ...）
  }
  ```
- 新增导出纯函数 `isExcluded(relPath: string, excludes?: ManifestOptions['excludes']): boolean`：
  - shadowGit=false：relPath 任意路径段 === `shadow-git` → true
  - conflictCopies=false：basename 匹配 `*.conflict-*`（最后一个点切 stem/ext 后再跟 `.conflict-<短ID>`，兼容 dotfile；至少 `.conflict-` + 1 位以上尾缀）→ true
  - disabledItems：relPath === `<file item>`（settings.json 等 3 个文件项）或 relPath === `<dir>` / 以 `<dir>/` 前缀（7 个目录项；stocks/feishu 不在此过滤，仍走 OPTIONAL_DIR_FLAGS）
  - excludes 缺省 → 全 false（现状行为）
- `buildManifest` / `walkDir` / `walkWorkspacesDir` / 顶层 `statFile` 应用 isExcluded（目录命中剪枝，文件命中跳过）。
- 现有硬编码排除（后缀/目录名/basename/符号链接）不动。

### 2. 拉取侧：`sync/manifest.ts` diffManifests 或 `sync/orchestrator.ts` 拉取循环

- 对端清单条目 relPath 命中 isExcluded（本端 excludes）→ 跳过，不进 pull/冲突集合。选 diffManifests 内做（离 diff 分类最近，orchestrator 不用改拉取循环）；实现时确认 buildNextBaseline（orchestrator.ts:442）透传同一 options，基线以过滤后清单自然清洗。

### 3. 应用侧：`sync/apply.ts`

- `applyIncoming` 入口对每条 relPath 过 isExcluded → 直接丢弃（计数进 skipped，日志注明），挡旧版本对端推来的文件。

### 4. `sync/protocol.ts`

- `SYNC_PROTOCOL_VERSION` +1；检查 device.ts/discovery.ts 握手警告路径正常带出。

### 5. 单测（新文件 `sync/exclude.test.ts`）

- isExcluded：三类规则 × 边界（路径段中间的 shadow-git、`.conflict-` 在 stem 中间不含尾缀、`xx.json.conflict-4cc497` 精确命中、disabledItems 前缀与整目录等值、`workspaces/abc` vs `workspaces.json`、excludes 缺省全放行）。
- buildManifest：临时目录造样例（含 shadow-git/ 子目录、.conflict-* 文件、被 disable 的目录）断言清单不含；excludes 缺省时含。
- diff/apply 对称过滤：对端清单含排除路径 → 不产出拉取/写入。

## 验收

- `bun test`（或项目现行测试命令）全绿；新测试覆盖上述边界。
- 手动：用本机真实数据目录跑一次 buildManifest（dev 下 `cwd/.dogear`），确认 shadow-git 与 4 个存量 .conflict-4cc497 不再进清单、其余条目数与改动前一致（可 diff 两份清单）。

## 不做

- 不动 settings 链路（Step 2）；不动 UI（Step 3）；不删存量副本/shadow-git 文件。
