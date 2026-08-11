# staged-execution Skill 改动清单

配合工具描述和系统提示词改动，去掉 skill 中冗余的工具名引用。原则：只在"必须严格锁死方式"时保留工具名，其余改为行为描述。

## 改动判断标准

- **写工具名** = 选错有后果，且其他层（工具描述/系统提示词）没覆盖
- **不写** = 其他层已覆盖，或 agent 有合理判断空间

## 逐处改动

### 1. 主/子分工表

```
旧：
| **子会话** | 按 task 描述改代码 / SaveSharedNote 到 outputPath / SendMessage(父sessionId, summary, { delivery: true }) 交付 | 派孙会话（没 CreateSession 工具）/ 越 step 边界改动 / 动 `.claude/**` 下任何文件 |

新：
| **子会话** | 按 task 描述改代码 / 把交付文档写到共享区 / 向派出会话交付结果 | 越 step 边界改动 / 动 `.claude/**` 下任何文件 |
```

理由：交付路径和方式由子会话契约段严格定义，skill 不重复。"没 CreateSession 工具"是实现细节，改为不提（禁止项里保留行为约束即可）。

### 2. 分派规则 - 默认派出

```
旧：
用 `CreateSession` 派出，参数：
- `task`：**必须**包含以下三块（照抄，别自己简写）：
  1. `docs/plans/**/stepN-*.md` 的完整绝对路径
  2. plan.md「全局决策」段原文
  3. 交付要求：「按 stepN.md 的 计划改动 段实施代码；完成后 SaveSharedNote 到 outputPath；然后先 ListLinkedSessions 拿派出者 sessionId，再用 SendMessage(sessionId, summary, { delivery: true }) 交回改动清单」
- `outputPath`：约定为 `stepN-delivery.md`（保持组共享区可追溯）
- `title`：`step N: <stepN.md 的 title>`

新：
派出子会话，task 描述包含以下三块（按模板填写，N 替换为实际步骤号）：
1. stepN.md 的完整路径
2. plan.md「全局决策」段原文
3. 交付要求：「按 stepN.md 的「计划改动」段实施代码；完成后把交付文档写到共享区 stepN-delivery.md；然后用 ListLinkedSessions 查派出者 sessionId，向其交付改动清单」
交付路径约定为 stepN-delivery.md，标题约定为「step N: <stepN.md 的 title>」
```

理由：
- 去掉 `SaveSharedNote` / `SendMessage` / `outputPath` 占位符 — 契约段已覆盖
- 保留 `ListLinkedSessions` — 子会话需要具体操作步骤获取父 sessionId，契约段没覆盖这个动作
- "照抄"改为"按模板填写，N 替换为实际步骤号" — 避免主会话机械复制占位符

### 3. 什么时候分多个子会话

```
旧：
- 可以用 CreateSessionBatch 一次派 N 个，每个独立 outputPath

新：
- 可以批量派出 N 个，每个独立交付路径
```

### 4. 执行循环

```
旧：
3. 主会话判定分派策略（默认单子会话；微改动自己做；独立多块 → CreateSessionBatch）
4. CreateSession / CreateSessionBatch 派出，task 描述按上面「分派规则」的三块拼
5. WaitForMessage 等交付（fromSessionIds=派出的子会话 sessionId 列表）

新：
3. 主会话判定分派策略（默认单子会话；微改动自己做；独立多块 → 批量派）
4. 派出子会话，task 描述按上面「分派规则」的三块拼
5. 等待子会话交付
```

理由：协作段已严格说"派出后必须 WaitForMessage"，不重复。

### 5. 执行循环 7a 验收通过

```
旧：
- 读子会话产出的 stepN-delivery.md，把关键内容回填到 stepN.md 的「实施回填」段

新：
- 从共享区读交付文档，把关键内容回填到 stepN.md 的「实施回填」段
```

### 6. 验收清单

```
旧：
- [ ] `stepN-delivery.md` 内容存在且格式合理（改动清单 + 关键签名 + 遗留问题）

新：
- [ ] 确认共享区有交付文档，读其内容，格式合理（改动清单 + 关键签名 + 遗留问题）
```

### 7. 失败处理

```
旧：
- 小问题：SendMessage 让子会话修（走契约通道，走 delivery=false 的普通消息）
- 大方向错：StopSession + 分析原因 + 重派或改 stepN.md

新：
- 小问题：向子会话发消息让它修
- 大方向错：停掉子会话 + 分析原因 + 重派或改 stepN.md
```

### 8. 反模式

```
旧：
- 「子会话卡住了，我 SendMessage 疯狂指导它」→ 3 次不成 = 停下，不无限循环

新：
- 「子会话卡住了，我疯狂发消息指导它」→ 3 次不成 = 停下，不无限循环
```

## 保留工具名的地方

全文唯一保留工具名的是分派规则第 3 块交付要求中的 `ListLinkedSessions`：

```
然后用 ListLinkedSessions 查派出者 sessionId，向其交付改动清单
```

理由：这是子会话需要执行的具体操作步骤（先查 sessionId → 再交付），契约段只说了"向派出你的会话交付"，没说怎么拿到 sessionId。保留工具名补上这个操作指引。

## 涉及代码

- `resources/skill-templates/staged-execution/SKILL.md`
