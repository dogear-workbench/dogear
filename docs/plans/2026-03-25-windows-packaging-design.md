# Dogear Windows 打包发布设计

> 日期：2026-03-25
> 目标：生成 Windows NSIS 安装包，一体化安装 Dogear + Git 依赖

---

## 一、背景

项目从 Next.js 迁移到 Vite 后，`electron-builder.yml` 配置已过时。需要：
1. 修正打包配置以适配 Vite 构建产物
2. 生成 NSIS 安装包（而非当前的 dir 模式）
3. 在安装时自动检测和安装 Git（Agent Bash 工具需要）

## 二、用户端环境依赖分析

| 依赖 | 打包内含 | 需要额外安装 | 说明 |
|------|----------|-------------|------|
| Chromium | ✅ | ❌ | Electron 自带 |
| Node.js | ✅ | ❌ | Electron 自带 |
| Agent SDK | ✅ | ❌ | 在 node_modules 中，打入 app.asar |
| 所有 npm 包 | ✅ | ❌ | 同上 |
| Git | ❌ | ✅ | Agent Bash 工具可能执行 git 命令 |
| Bun | ❌ | ❌ | 仅开发时需要 |
| API Key | ❌ | 用户配置 | 应用内设置页面填写 |

## 三、整体方案

### 3.1 最终产物

```
dist/
└── Dogear Setup 1.0.0.exe    (~150-200MB)
```

### 3.2 用户安装流程

```
双击 Dogear Setup 1.0.0.exe
→ 欢迎页面
→ 检测 Git 是否已安装
   ├─ 已安装 → 跳过
   └─ 未安装 → 提示并静默安装内嵌的 Git 安装包
→ 选择安装路径（默认 C:\Users\xxx\AppData\Local\Programs\Dogear）
→ 可选：创建桌面快捷方式
→ 安装完成 → 启动 Dogear
```

### 3.3 用户数据存储

保持现状不变：
- 开发：`process.cwd()/.dogear/`
- 打包：`path.dirname(app.getAppPath())/.dogear/`（即 `resources/.dogear/`）
- NSIS 更新安装只替换 files 列表中的文件，不会触碰 `.dogear/` 目录

## 四、实施详情

### 4.1 修正 electron-builder.yml

**移除过时引用：**
- `electron/dist/**/*` → 已不存在
- `.next/**/*` → 已迁移到 Vite
- `app/**/*` → Vite 已打包到 `out/`
- `next.config.*.js` → 不再需要
- `components.json`、`tailwind.config.ts` → 运行时不需要

**添加正确的文件：**
- `out/**/*` — Vite 前端构建产物
- `dist/**/*` — 编译后的 Electron 主进程代码

**最终 files 配置：**
```yaml
files:
  - dist/**/*           # 编译后的主进程 + preload
  - out/**/*            # Vite 前端构建产物
  - node_modules/**/*   # npm 依赖
  - package.json
```

### 4.2 NSIS 安装包配置

```yaml
win:
  target:
    - target: nsis
      arch: x64
  icon: build/icon.ico  # 应用图标

nsis:
  oneClick: false                    # 非一键安装，允许选择路径
  perMachine: false                  # 安装到用户目录，无需管理员权限
  allowToChangeInstallationDirectory: true  # 允许更改安装路径
  createDesktopShortcut: true        # 创建桌面快捷方式
  createStartMenuShortcut: true      # 创建开始菜单快捷方式
  include: build/installer.nsh       # 自定义 NSIS 脚本（Git 检测+安装）

extraResources:
  - from: build/installers/Git-2.47.1-64-bit.exe
    to: installers/Git-2.47.1-64-bit.exe
```

### 4.3 NSIS 自定义脚本 (build/installer.nsh)

在安装前检测 Git，如果未安装则执行内嵌的 Git 安装包：

```nsis
!macro customInit
  ; 检测 Git 是否已安装
  nsExec::ExecToStack 'git --version'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_YESNO "Dogear 需要 Git 支持 AI Agent 功能。$\n$\n是否立即安装 Git？" IDYES installGit IDNO skipGit
    installGit:
      DetailPrint "正在安装 Git..."
      File /oname=$TEMP\Git-Setup.exe "$INSTDIR\..\installers\Git-2.47.1-64-bit.exe"
      ExecWait '"$TEMP\Git-Setup.exe" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"'
      Delete "$TEMP\Git-Setup.exe"
    skipGit:
  ${EndIf}
!macroend
```

### 4.4 应用图标

需要准备 `build/icon.ico`（Windows 图标，至少 256x256 像素）。

### 4.5 Git 离线安装包

需要手动下载放置到 `build/installers/` 目录：
- 下载地址：https://github.com/git-for-windows/git/releases
- 文件名：`Git-2.47.1-64-bit.exe`（约 55MB）
- 此文件不提交到 git（加入 .gitignore）

## 五、目录结构变更

```
build/                            # 新增打包资源目录
├── icon.ico                      # Windows 应用图标
├── installer.nsh                 # NSIS 自定义安装脚本
└── installers/                   # 离线安装包
    └── Git-2.47.1-64-bit.exe    # Git 离线安装包（.gitignore 忽略）
```

## 六、打包命令

```bash
# 一键打包（已有脚本，只需修正配置）
bun run dist

# 等价于：
# bun run build:renderer   → Vite 构建前端到 out/
# bun run build:electron   → tsc 编译主进程到 dist/
# electron-builder         → 打包为 NSIS 安装包
```

## 七、开发者打包检查清单

1. `build/icon.ico` 是否存在
2. `build/installers/Git-2.47.1-64-bit.exe` 是否已下载放置
3. `bun run build` 是否通过（无编译错误）
4. 运行 `bun run dist` 生成安装包
5. 在干净 Windows 机器上测试安装
