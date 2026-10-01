# 备份无变更跳过（skip-unchanged）实施计划

**目标**：调度路径下 scope 源内容与上次成功备份一致时不打新 zip（记 last-run skipped），面板展示「内容无变化，已跳过」；手动备份与恢复预备份不受影响。

**架构思路**：备份前对源做 readdir+stat 签名（路径+mtime+size → sha1），与 last-run 记录的上次签名比对决定跳过与否；到期锚点改为 max(zip 时间戳, last-run 执行时间) 消除跳过后的空转。设计详见同目录 [design.md](./design.md)。排除的选项：按工作区手动配频率（把自动化转成维护负担）、按会话活动感知降频（活动信号定义不可靠）。

**涉及模块**：`backup-service/source-signature.ts`（新）、`last-run.ts`、`schedule.ts`、`index.ts`、`app/data-center/version-backup/CategoryCard.tsx`、tipc 自动类型推导。

## 步骤索引

- [ ] [Step 1: 主进程 skip 链路（签名模块 + last-run 扩展 + isDue 改造 + 调度插点）](./step1-skip-pipeline.md) — 备份行为本身成立，测试验证
- [ ] [Step 2: 前端跳过状态展示](./step2-ui-status.md) — CategoryCard 提示行 + 文档同步

## 全局决策

- skip 只在 onlyDue 调度路径生效；手动「立即备份」与恢复预备份（runBackupInner 直调）永不跳过
- skipped 视为成功执行（ok=true, error=null），lastError 语义不变
- 签名遍历必须与 packSources 文件收集语义一致（不存在源跳过、只算文件、外部锚点按绝对路径扫），从 zip-pack-core 复用/提取遍历，禁止另写一套
- 签名算法：sha1(排序拼接的 `relpath|mtimeMs|size`)，hex 存储；无任何存在文件 → null
- isDue 到期锚点 = max(最新 zip 时间戳, last-run 该 key 执行时间)
- last-run.json 是 registry 排除项不跨设备，签名丢失 → 首次必打一份自愈，无需迁移逻辑
- 签名计算失败按「有变化」处理，走正常备份
- 不做跳过计数（YAGNI），只展示最近一次跳过时间
