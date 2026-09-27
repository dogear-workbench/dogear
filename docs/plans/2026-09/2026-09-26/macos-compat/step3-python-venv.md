---
step: 3
title: Python venv 化（darwin）
status: done
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
  1. venv 逻辑独立成新文件 `electron/main/services/stock/python-venv.ts`（bridge 与 environment 两消费方共用，避免漂移；python-bridge.ts 已 560 行，符合拆分规范），计划中的 `getVenvPythonPath()` 名称保留
  2. `ensureDependencies()` 未加显式 darwin 分支：detectPython 已保证 darwin 传入 venv python，`-m pip install` 天然装入 venv；实际改动仅为含空格路径引号处理（win 等价包装，命令字符串逐字符不变）
  3. `ensureVenv()` 返回 `{ pythonPath, recreated }` 而非裸路径：venv 重建时 python-bridge 需重置 `depsVerified` 依赖缓存
  4. probeVenvPython 除 `--version` 外额外校验 `-m pip --version`：缺 pip 的 venv 也是一种半成品形态，纳入删除重建覆盖
- 改动文件清单：
  - 新增 `electron/main/services/stock/python-venv.ts`（getVenvDir / getVenvPythonPath / parsePythonVersion / isSupportedVersion / detectSystemPython3 / probeVenvPython / shellQuotePath / ensureVenv）
  - `electron/main/services/stock/python-bridge.ts`：detectPython 头部 darwin 分支（ensureVenv + recreated 时重置 depsVerified）；ensureDependencies 含空格路径引号（win 等价包装）
  - `electron/main/tipc/environment.ts`：detectPythonCmd 头部 darwin 分支（venv 优先 + 系统 ≥3.10 解析校验）；checkEnvironment 包检测 pyCmd 引号；installPythonDeps 头部 darwin 分支（ensureVenv → venv pip 装）
  - `app/settings/WorkspaceManagementTab.tsx`：isMac（client.getPlatform）+ Python 未安装时 brew/CLT 安装提示
- 验证：build:electron ✓ / lint 0 errors ✓ / dev 冒烟主进程正常 ✓ / git diff 逐点核对 win32 等价 ✓；darwin 链路未真机验证，留 Step 6

### 给下一步的接力棒
- 关键签名 / 数据结构：详见共享区 `macos-compat/step3-delivery.md`「关键签名」段——ensureVenv(): { pythonPath, recreated }，throw message 即 UI 文案（首行问题 + 可执行命令）
- 下个 step 该从哪里继续：venv 运行时创建于 userData 不随包分发，打包无需为 venv 配置；Step 6 真机清单：首次一键安装应建 venv 并装满依赖、破坏 venv 后应自动删除重建、股票页指标走 venv python
- 待办或已知限制：baostock × Python 3.13 兼容性未验证（审计遗留项）；venv 创建依赖 Step 1 PATH 注入成功
