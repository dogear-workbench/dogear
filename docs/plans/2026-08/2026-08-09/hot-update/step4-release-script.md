---
step: 4
title: 智能发布脚本 + 本地 HTTP 服务
status: pending
---

## 目标
一条 `bun run release` 命令完成：自动递增版本号 → 编译构建 → 自动判断热更新/全量 → 产出更新包 + manifest → 复制到本地 HTTP 服务目录。同时提供 `bun run serve-updates` 启动本地 HTTP 服务。

## 依赖上下文（接力棒输入）
- Step 1 产出：out/ 已移出 asar，打包后在 `resources/out/`
- Step 2 产出：客户端能读 manifest.json，格式见 plan.md 全局决策
- 当前 package.json scripts：有 `build:electron`、`build:renderer`（实际叫法需确认）、`dist`、`dev`
- electron-builder.yml：`directories.output: release`

## 计划改动

### scripts/release.mjs（新建）
发布脚本逻辑：
- [ ] 读取当前 `package.json` version，patch +1，写回
- [ ] 跑 `bun run build:electron`（编译主进程 → dist/）
- [ ] 跑 `bun run build:renderer`（Vite 构建 → out/）
- [ ] 计算 `dist/` 目录 hash（递归 hash 所有文件内容）
- [ ] 对比上次发布的 dist/ hash（存在 `.release-state.json`）
  - hash 相同 → 走热更新路径：
    1. 把 `out/` 打成 `update-{version}.zip`
    2. 计算 zip 的 sha256
    3. 生成 manifest.json（type=hotfix）
    4. 复制 zip + manifest.json 到 HTTP 服务目录
  - hash 不同 → 走全量路径：
    1. 跑 `bun run dist`（electron-builder 全量打包）
    2. 从 `release/` 提取 .exe + .exe.blockmap + latest.yml
    3. 生成 manifest.json（type=full）
    4. 复制全部到 HTTP 服务目录
- [ ] 更新 `.release-state.json`（记录 dist/ hash + 版本号 + 类型）

### scripts/serve-updates.mjs（新建）
- [ ] 用 Node.js http 模块启动静态文件服务器
- [ ] 根目录默认 `./update-server/`（或可配置）
- [ ] 端口 9527
- [ ] 必须支持 Range Request（热更新下载需要，虽然 zip 是整体下载不严格需要 range，但预留兼容）
- [ ] 控制台打印访问地址

### package.json scripts
- [ ] 新增 `"release": "node scripts/release.mjs"`
- [ ] 新增 `"serve-updates": "node scripts/serve-updates.mjs"`

### .gitignore
- [ ] 添加 `update-server/`（HTTP 服务目录，不放仓库）
- [ ] 添加 `.release-state.json`（发布状态记录）

### update-server/ 目录结构
```
update-server/
  manifest.json       ← 最新版本信息
  update-0.1.2.zip    ← 热更新包（type=hotfix 时）
  Dogear Setup 0.1.2.exe       ← 全量安装包（type=full 时）
  Dogear Setup 0.1.2.exe.blockmap
```

## 实施回填（做完后填）

### 实际改动
（待填）

### 给下一步的接力棒
（待填）
