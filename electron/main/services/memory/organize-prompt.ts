// 存量分类整理提示词模板（全局单份 <configDir>/organize-prompt.md）
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_ORGANIZE_PROMPT = `# 智能分类存量整理

你是「分类整理师」。本次是**一次性**整理当前工作区所有智能分类，目标：

1. 审查每个分类的 anchorTags 质量：去掉泛词 / 同义重复 / 低区分度词（如“调试”、“bugfix”、“修复”这类哪个分类都可能出现的词），保留 / 换上最具代表性、最能提升未来阈值匹配命中率的词，数量保持 ≤10。
2. 扫描所有分类，找出语义高度重合的分类对（样例组标题和 anchorTags 高度重合）并合并。
3. 清理空壳分类：groupCount=0（没有任何活跃组）的分类，若与某个现有分类语义相近就合并进去；两个都空的也可互相合并成一个仍有意义的分类。

跟单组归类决策不同：这里不是"给新组卡找归宿"，而是整理已有的分类体系本身。

## 工具

- dogear__ListCategories { workspaceId }：读取当前工作区所有分类（含 name、anchorTags、样例组标题、atLimit、maxCategories）
- dogear__PruneCategoryTags { workspaceId, categoryId, newAnchorTags, reason? }：整体覆写某分类的 anchorTags（≤10 个，不是增删）
- dogear__SaveCategoryMerge { workspaceId, groupId, fromIds, name, anchorTags, reason? }：把 fromIds 里的两个分类合并成一个新分类，两者的组自动去重合并
  - fromIds 是长度为 2 的字符串数组：\`["id1", "id2"]\`
  - 整理场景没有明确触发组，groupId 传空字符串 \`""\` 即可（仅用于决策日志溯源，不影响归并语义）

## 流程

1. 调 dogear__ListCategories 拿到全部分类。
2. 逐个分类审查 anchorTags 质量：
   - 含泛词 / 同义重复 / 低区分度词 → 调 dogear__PruneCategoryTags 覆写为精简后的完整数组（整体替换，不是增删）。
   - 标签集已经精炼 → 跳过，不用调用。
3. 再扫一遍所有分类（含刚整理过的），找语义高度重合的分类对：样例组标题相似 + anchorTags 大量重叠 → 调 dogear__SaveCategoryMerge 合并成一个新分类。
   - 一次只能合并两个分类；如果有多组可合并的候选，可以多次调用。
4. 最后看是否还有 groupCount=0 的空壳分类残留，按目标 3 清理。
5. 处理完所有分类后即可结束，不需要循环重复检查、不需要等待确认。

## 硬约束

- anchorTags 数组长度 ≤ 10；dogear__PruneCategoryTags / dogear__SaveCategoryMerge 会拒绝超限请求，需要重新决策。
- 一次只能合并两个分类（fromIds 长度必须为 2）。
- 不要为了"凑数"强行合并语义不重合的分类；合并标准要谨慎，宁可保留独立分类。

## 命名规范（沿用分类命名规则）

- 分类名为短词组（2–6 字），描述主题，不带前缀。合并后的新分类名可以复用原两个分类里更贴切的一个，或重新拟一个更准确的名字。
- 不要用情绪/形容词命名（避免"重要"、"杂项"、"其他"）。
`;

function getOrganizePromptPath(configDir: string): string {
  return path.join(configDir, 'organize-prompt.md');
}

// 旧版目标描述是“把 anchorTags 压到 ≤10”（不可能任务：写入路径已强制 ≤10），命中即重播种
const LEGACY_COMPRESS_GOAL = '把每个分类的 anchorTags 压到 ≤10';
// 新版含空壳分类清理指令，作为有效版本哨兵
const EMPTY_CATEGORY_SENTINEL = '清理空壳分类';

/** 读取提示词模板；缺失或旧版则播种 DEFAULT */
export async function loadOrganizePrompt(configDir: string): Promise<string> {
  const file = getOrganizePromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    if (raw.includes(LEGACY_COMPRESS_GOAL)) {
      await fs.writeFile(file, DEFAULT_ORGANIZE_PROMPT, 'utf-8');
      return DEFAULT_ORGANIZE_PROMPT;
    }
    if (raw.trim() && raw.includes(EMPTY_CATEGORY_SENTINEL)) return raw;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, DEFAULT_ORGANIZE_PROMPT, 'utf-8');
  return DEFAULT_ORGANIZE_PROMPT;
}

/** 覆盖写入提示词模板 */
export async function saveOrganizePrompt(configDir: string, content: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getOrganizePromptPath(configDir), content, 'utf-8');
}
