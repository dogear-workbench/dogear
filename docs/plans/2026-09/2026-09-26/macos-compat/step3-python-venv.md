---
step: 3
title: Python venv 化（darwin）
status: pending
---

## 目标
mac 上股票计算层可用：Homebrew Python 的 PEP 668 拒绝直装问题解决；Windows 安装链路零改动。

## 依赖上下文（接力棒输入）
- 审计依据：`20260926-main-process-audit.md` ❌-1、⚠️-2；`20260926-build-frontend-audit.md` A4
- 前置 step 产出：step1 的 PATH 注入已完成（venv 创建依赖能找到 python3）

## 计划改动
- [ ] `electron/main/services/stock/python-bridge.ts:360-460`：新增 `getVenvPythonPath()`——venv 目录 `join(app.getPath('userData'), 'python-venv')`；darwin 下解析器选择顺序：venv 存在 → `venv/bin/python`；不存在 → 探测系统 python3 → `python3 -m venv <dir>` 创建 → 用 venv pip 装依赖。`ensureDependencies()`（:407-460）darwin 分支装进 venv；win32 走原逻辑不动
- [ ] `electron/main/tipc/environment.ts:33-47` 版本校验：解析 minor 版本 ≥3.10（现有 `startsWith('Python 3')` 拦不住 CLT 的 3.9）；`:160-190` installPythonDeps 同步 venv 分支
- [ ] 环境检测页文案按平台分支：mac 提示「未检测到 Python？brew install python3 或安装 Xcode CLT」
- [ ] venv 创建失败的错误处理：权限/磁盘问题给用户可读文案；破坏的半成品 venv 目录要能重建（删除重建）
- [ ] Windows 回归：`bun run build:electron` + 环境检测页打开一次 + 股票页拉一次指标（确认 win32 分支未动）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
