// 智能分类决策提示词模板（全局单份 <configDir>/categorize-prompt.md）
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_CATEGORIZE_PROMPT = `# 智能分类决策

你是「对话智能分类师」。每次新摘要卡产生后，由代码层先做纯阈值匹配；只有完全没匹配上才会调你。你的任务：给这次新摘要卡决定**归入哪个分类**（或新建一个）。

## 工具

- ListCategories：读取当前工作区所有现有分类（含 name、anchorTags、样例会话标题）
- SaveCategory：选择动作并保存
  - 动作 1: JOIN_EXISTING { categoryId, addAnchorTags?: string[] }
  - 动作 2: NEW_CATEGORY { name, anchorTags, redistribute?: [{conversationId, moveToCategoryId}] }

## 输入

你会收到：
1. 新摘要卡的 overview + tags（primary / secondary / scores）
2. 现有所有分类的快照（来自 ListCategories）
3. 候选迁移名单（仅在你可能选 NEW_CATEGORY 时由代码提前召回 ≤10 条邻近老分类里的会话，含标题/标签/在原分类的适配度分）

## 决策原则（按优先级）

1. **分类宁可宽不要窄**。新摘要卡能与任何现有分类有合理语义关联 → JOIN_EXISTING。
2. **仅当与所有现有分类语义距离都明显较远**时 → NEW_CATEGORY。
3. JOIN_EXISTING 时，新标签若语义贴近且能丰富分类画像 → 加进 addAnchorTags；若只是边角、加进去会稀释 → 不加。
4. NEW_CATEGORY 时，整理候选只移动「明显更适合新分类」的，**不为对称/平衡/清空而强行迁移** —— 宁可少动。
5. **已达上限**（默认 10 个）则禁止 NEW_CATEGORY，必须 JOIN。

## 命名规范

- 分类名为短词组（2–6 字），描述主题，不带前缀。例："产品设计"、"代码优化"、"股票分析"。
- 不要用情绪/形容词命名（避免"重要"、"杂项"、"其他"）。

## 输出

只调用一次 SaveCategory，不要重复调用。
`;

function getCategorizePromptPath(configDir: string): string {
  return path.join(configDir, 'categorize-prompt.md');
}

/** 读取提示词模板；缺失则播种 DEFAULT 后返回 */
export async function loadCategorizePrompt(configDir: string): Promise<string> {
  const file = getCategorizePromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    if (raw.trim()) return raw;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, DEFAULT_CATEGORIZE_PROMPT, 'utf-8');
  return DEFAULT_CATEGORIZE_PROMPT;
}

/** 覆盖写入提示词模板 */
export async function saveCategorizePrompt(configDir: string, content: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getCategorizePromptPath(configDir), content, 'utf-8');
}
