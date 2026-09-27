---
step: 6
title: 真机验证
status: pending
---

## 目标
在用户 ARM Mac 上跑通全链路，逐项关闭审计报告的待验证清单。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1-5 代码已完成且 Windows 回归通过
- 用户配合事项：在 Mac 上装 Xcode CLT（`xcode-select --install`）、clone 代码、`bun install`、按下面清单逐项验证并反馈结果

## 计划改动（验证项，非代码）
- [ ] dev 基本盘：CLT → `bun install`（node-pty × Electron 39 × darwin-arm64 编译一次过？）→ `bun run dev` 跑通
- [ ] Step1 验证：PATH 注入后环境检测页 git/python/bun 全绿；Cmd+C/V 可用；红绿灯不压标题；红叉后 Dock 可唤回；托盘图标正常
- [ ] 标题栏定案：hiddenInset 实际表现——布局崩则启用 step1 预留的 fallback（titleBarOverlay + 前端 padding）
- [ ] Step2 验证：mac 上 `bun run dist` 出 dmg+zip，图标正确，安装后可启动（Gatekeeper 本机构建不拦）
- [ ] Step3 验证：首次打开股票页 → venv 创建 + 依赖安装成功 → 指标/选股跑通；CLT python3 实际版本记录（决定版本门槛文案）
- [ ] Step4 验证：注册 NM host 后 Chrome/Edge 扩展与 Dogear 连通（unix socket）
- [ ] Step5 验证：hotfix 应用后 app 能正常重启（userData 方案下签名不受影响）；全量 zip 下载-替换流程
- [ ] 反馈回填：每项结果记入本文件回填区；发现的新问题开新 step 或工单

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
