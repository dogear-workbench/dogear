# macOS ARM 兼容适配 实施计划

**目标**：Dogear 在 ARM Mac（Apple Silicon）上 dev 可跑、可打包自用、核心功能（股票计算层/浏览器扩展/更新）可用，且 Windows 行为零回归。

**架构思路**：全部改动采用「平台分支」模式——`process.platform === 'darwin' ? mac实现 : 现有Windows逻辑`，不重构共享主干。Python venv 化第一阶段只对 darwin 启用 venv（Windows 保持直装，零回归风险），稳定后再考虑统一。依据：两份审计报告（会话组共享区 `macos-compat/20260926-main-process-audit.md`、`macos-compat/20260926-build-frontend-audit.md`），文件:行号均出自报告。

**涉及模块**：`electron/main/main-app.ts`、`electron/main/tray.ts`、`electron/main/window-factories.ts`、`electron/main/services/stock/python-bridge.ts`、`electron/main/tipc/environment.ts`、`electron/main/services/browser/nm-protocol.ts`、`electron/main/services/update-service.ts`、`electron-builder.yml`、`scripts/*.mjs`、`src/components/TitleBar.tsx`

## 步骤索引

- [x] [Step 1: 主进程体验适配](./step1-main-adaptations.md) — PATH 注入 + 菜单栏 + activate + 托盘 + 标题栏五处小分支
- [ ] [Step 2: 打包配置与资源](./step2-builder-config.md) — electron-builder mac 段 + icns/png 图标 + extraResources 平台过滤
- [ ] [Step 3: Python venv 化](./step3-python-venv.md) — darwin 分支走 venv + 版本校验（Windows 不变）
- [ ] [Step 4: NM host 跨平台](./step4-nm-host.md) — unix socket + sh 脚本 + plist 注册 + 运行时注册入口
- [ ] [Step 5: 更新机制 mac 分支](./step5-update-channel.md) — 热更 userData 化 + manifest 平台维度 + release 脚本
- [ ] [Step 6: 真机验证](./step6-on-device-verification.md) — 待验证清单逐项执行（需用户配合 Mac）

## 全局决策

- **平台分支统一写法**：判断 `process.platform === 'darwin'`，Windows 路径保持原逻辑不动；不抽平台抽象层（改动点少，抽象过度）
- **Windows 回归义务**：Step 1-5 每步完成后在 Windows 上 `bun run build:electron` 编译通过 + 触碰该步改动对应功能一次（Step 4 验浏览器扩展连通、Step 5 验一次热更/发布 dry-run）
- **Python 策略**：venv 仅 darwin；Windows 直装路径代码不动
- **图标资源**：mac 需要 `build/icon.icns`（≥512px png 派生，iconutil 生成）+ 托盘用 16/32@2x png；ico 保留给 Windows
- **行号基准**：审计报告行号以 2026-09-26 工作区为准，执行时若代码已漂移，按报告中的符号名/上下文重新定位
- **不做**：Developer ID 签名 + 公证（阶段二，自用不需要）；universal binary（只做 arm64）
