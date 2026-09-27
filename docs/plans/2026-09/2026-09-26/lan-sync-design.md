# 局域网交接同步（LAN Sync）设计

**背景**：用户有两台设备（Windows 台式 + ARM MacBook），**交替使用**同一份数据——Windows 用完带 Mac 出门，回来再同步回去。同一时间只有一端在写数据，因此不需要实时双向引擎（排除 Syncthing 外挂：多一个外部软件要装要学，排除规则靠手写），在 Dogear 内置「交接式」同步。

**目标**：
- 同一局域网下打开 Dogear 即发现对端（mDNS），数据中心面板显示在线状态与变化
- 一键触发增量双向同步（用户拍板：提示 + 一键确认，不自动同步）
- 冲突绝不静默丢数据
- 首次全量 ~900M（千兆局域网分钟级），日常增量秒级

**架构**：
- **发现**：mDNS 广播 `_dogear._tcp`（库选型待实测：bonjour-service vs @homebridge/ciao，见未决问题）
- **传输**：主进程内嵌 HTTP 对等服务，仅监听局域网；首次配对两端各显示 6 位配对码确认，交换设备密钥持久化，之后仅配对设备可访问
- **同步协议**（点同步后）：
  1. 两端交换文件清单：白名单目录下相对路径 + mtime + size；变化候选（mtime/size 不同）再算 hash
  2. diff 三分类：对端新/改 → 拉取；本地新/改 → 推送；双方都改 → **LWW（mtime 新者赢）+ 旧方存 `<name>.conflict` 副本**
  3. 流式传输变化文件（gzip），临时文件 + rename 原子写入；任意时刻中断可重试（幂等，按清单重算）
  4. 完成后各端写 sync-state（对端设备 ID、时间、清单 hash）
- **版本握手**：协议带 Dogear 版本号，两端版本差异时警告并允许用户选择继续（数据格式随版本演进，防老版本读坏新数据）

**同步范围**（默认白名单，面板可调整可选项）：
- 恒定同步：workspaces/（含文章库、笔记、话题、git 仓库——git 仓库整体文件级同步在交替使用下安全，排除 `*.lock` 锁文件与 `__pycache__`）、conversations/、memory/、usage/、settings.json（已验证无机器特定路径）、plans.json、notifications.json、article-parser/、site-knowledge/、run-history/
- **可选项（默认关）**：stocks/ 行情缓存（自选股配置恒定同步，行情数据 32M+ 可重新拉取，默认不同步省流量）；feishu/（用户少用，默认不同步）
- 恒定排除：browser-profile/（浏览器二进制态，同步必坏）、logs/、backups/、`*.bak`

**模块边界**：
- `electron/main/services/sync/`（新模块）：`discovery.ts`（mDNS）、`server.ts`（HTTP 服务）、`protocol.ts`（配对/清单/传输协议）、`manifest.ts`（清单生成与 diff）、`apply.ts`（原子写入 + 冲突副本）
- `electron/main/tipc/sync.ts`（新路由）：对端状态查询、触发同步、配对确认、同步历史、可选项读写
- 前端：数据中心新增「设备同步」面板（对端在线状态、上次同步时间、一键同步按钮、冲突副本列表、可选项开关）；应用启动检测到对端有新变化时弹通知（不自动同步）
- settings.json 新增 `syncOptions: { deviceName, syncStocksData, syncFeishu }` 与配对设备列表

**数据流**：打开应用 → mDNS 发现对端 → 面板显示在线 → 用户点「同步」→ 交换清单 → diff → 双向传输 → 原子写入 + sync-state → 完成通知（含拉取/推送/冲突计数）

**错误处理 / 边界情况**：
- 同步中断：幂等重试，下次按清单重算
- 对端中途退出：本次同步标记未完成，已写入文件保留（原子写不会撕裂）
- 版本不兼容：警告 + 用户确认
- 文件被占用（同步中 agent 正在写会话文件）：跳过并在结果里报告，下次同步补齐
- Windows 防火墙首次拦截 mDNS/入站：弹系统允许提示，面板给出引导文案

**未决问题**：
- mDNS 库选型（bonjour-service vs ciao）以 Electron 主进程实测为准
- 传输是否需要分块校验（大文件如文章附件 >50M 时的断点）——v1 整文件 + gzip，超限文件少则不做
- 同步进行中本端后台任务写入的窗口策略——v1 接受「跳过占用文件下次补齐」，不暂停后台任务
