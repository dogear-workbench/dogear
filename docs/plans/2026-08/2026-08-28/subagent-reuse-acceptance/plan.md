# 子会话复用与交付闭环 实施计划

**目标**：把「复用 vs 新建」的判断权交给模型——机制上修通 SendMessage 自动调起、重启降级恢复、outputPath 可选化；提示词上补齐复用判断框架、验收闭环、交付自述义务与交付形态弹性。

**架构思路**：机制开路 + 提示词写判断依据，两者都不做倾向性硬编码。设计全文见 [../2026-08-28-subagent-reuse-and-acceptance-design.md](../2026-08-28-subagent-reuse-and-acceptance-design.md)。

**涉及模块**：`electron/main/agents/delegation-bridge.ts`、`electron/main/agents/delegation-resume.ts`、`electron/main/agents/tools/delegation-tools.ts`、`electron/main/agents/session-append-templates.ts`；用户 settings.json（手动）。

## 步骤索引

- [x] [Step 1: CreateSession outputPath 可选化](./step1-output-path-optional.md) — 通讯型交付的机制前提
- [x] [Step 2: SendMessage 自动调起停机子会话](./step2-sendmessage-auto-resume.md) — 核心开路：追问不再吃闭门羹
- [x] [Step 3: ResumeSession 重启降级恢复](./step3-resume-after-restart.md) — 重启后复用能力不清零
- [x] [Step 4: 提示词层全套](./step4-prompt-updates.md) — 复用判断框架 + 验收闭环 + 契约弹性化
- [ ] [Step 5: 端到端验证 + Profile 手动调整](./step5-e2e-and-profile.md) — 走查闭环 + settings 调整

## 全局决策

- **不动调度兜底**：超时/transient 重试/quota failover/终态通知零改动。
- **交付零机械校验**：不做 delivery 时文件存在性检查；「忘了写文件」由交付自述 + 主会话验收暴露。
- **提示词不做倾向性硬编码**：不写「总是复用」，只写判断线（复用四条 + 验收三分支）。
- **`delivered` 保持运行时视角**：重启后恒为 false 是既有设计，降级重建 childState 时维持该语义（delegation-bridge.ts:628 conversationToSnapshot）。
- **主进程改动需 `bun run build:electron` 重编译**；Vite 热重载只对渲染层生效。
- **测试**：`bun test electron/main/agents/`，相关既有用例：delegation-resume.test.ts / delegation-regression.test.ts / delegation-idle.test.ts。
