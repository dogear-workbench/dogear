# 局域网交接同步 实施计划

**目标**：两台设备（Windows + ARM Mac）同局域网下，Dogear 内一键完成增量双向数据同步，交替使用无缝交接，冲突不丢数据。

**架构思路**：应用内对等同步——mDNS 发现对端 + 主进程内嵌 HTTP 服务 + 文件清单 diff（LWW + `.conflict` 副本）。不做实时持续同步（交替使用场景 YAGNI），不做操作日志/记录级合并（复杂度不值）。设计全文：`docs/plans/2026-09/2026-09-26/lan-sync-design.md`。

**涉及模块**：`electron/main/services/sync/`（新，5 文件）、`electron/main/tipc/sync.ts`（新路由）、数据中心前端面板、`settings.json`（syncOptions + 配对设备列表）

## 步骤索引

- [x] [Step 1: 清单与 diff 核心](./step1-manifest-diff.md) — manifest.ts：白名单遍历、mtime+size 粗筛、hash 精确比对、三分类 diff
- [x] [Step 2: 发现与服务](./step2-server-pairing.md) — mDNS 发现 + HTTP 对等服务 + 6 位码配对 + 设备密钥
- [x] [Step 3: 传输与应用](./step3-apply-routes.md) — 双向拉推流式传输、原子写入、冲突副本、tipc 路由
- [ ] [Step 4: 前端面板](./step4-ui-panel.md) — 数据中心「设备同步」面板 + 启动检测通知
- [ ] [Step 5: 双机联调](./step5-two-device-e2e.md) — Windows ↔ Mac 真机端到端（依赖 mac 适配完成后进行）

## 全局决策

- **白名单基准**（设计文档「同步范围」节）：恒定同步 workspaces/、conversations/、memory/、usage/、settings.json、plans.json、notifications.json、article-parser/、site-knowledge/、run-history/；可选项（settings `syncOptions.syncStocksData`/`syncFeishu`，默认 false）stocks/、feishu/；恒定排除 browser-profile/、logs/、backups/、`*.bak`、`*.lock`、`__pycache__`
- **冲突语义**：双改文件 mtime 新者胜，旧方内容写 `<name>.<ext>.conflict-<对端设备短ID>` 同目录副本；结果面板列出冲突文件
- **原子写**：全部经临时文件 + rename；同步幂等（中断后重跑按清单重算）
- **协议版本**：握手带 Dogear 版本号 + 协议版本，不匹配警告需确认
- **安全**：HTTP 服务仅监听配对过设备的请求（设备密钥 header 校验）；服务只在对端在线/同步期间有意义，常驻监听但拒绝未配对连接
- **不写单测**（项目偏好），核心逻辑（diff/清单）用真实数据目录手动验证
- 数据目录基准：`app.getPath('userData')/.dogear`（与现有服务一致）
