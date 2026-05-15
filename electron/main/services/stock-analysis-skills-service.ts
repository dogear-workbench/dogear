/**
 * Skill 模板服务（当前承载股票分析 Skill 模板）
 *
 * 与 agent-templates-service.ts 同款做法：模板内容内嵌为 TS 字符串常量，
 * 用户在设置页主动「订阅」时，复制为 `<workspace>/.claude/skills/<name>/SKILL.md`，
 * 之后由 SDK settingSources=['project'] 自动加载，副本可任意编辑。
 *
 * 注意：本服务**不**控制工具包是否注册——MCP server `dogear-stock-analysis`
 * 由 conversation-runtime-service 按 `enabledToolPacks` 注册，与 SKILL.md
 * 是否订阅完全独立。
 */

import path from 'path';
import fs from 'fs/promises';

export interface SkillTemplateMeta {
  /** Skill 名称（目录名） */
  name: string;
  /** SKILL.md 中的 description（订阅前供 UI 展示） */
  description: string;
}

const STOCK_ANALYSIS_SKILL_MD = `---
name: stock-analysis
description: 股票技术指标计算、条件筛选、财务分析、技术信号检测、自定义公式执行、简单策略回测。当用户询问"帮我筛选 PE<20 的银行股"、"茅台的 MACD 现在什么状态"、"今天有哪些金叉"、"这个策略历史表现如何"等场景时使用。
---

# 股票分析工作流

本技能描述使用 \`mcp__dogear-stock-analysis__*\` 工具进行股票分析时的推荐流程。
工具完整定义由 SDK Tool Search 按需加载，调用前若需详细参数可先 search。

## 何时使用

- 筛选股票（"帮我找 PE<20 且 ROE>15% 的消费股"）
- 计算技术指标（"茅台的 MACD/KDJ/RSI 现在什么状态"）
- 检测技术信号（"今天哪些股票出现 MACD 金叉"）
- 财务数据查询（"查一下贵州茅台最近 4 期营收和净利润"）
- 行业对比（"茅台在白酒行业估值处于什么水平"）
- 公式表达式（用户自定义 TDX 风格公式的验证和执行）
- 简单策略回测（"MACD 金叉买入、死叉卖出，近一年收益如何"）

## 标准工作流

1. **筛选优先**：用户提"找一批……"时，先用 \`ScreenStocks\` 在全市场用基本面条件（industry/pe/pb/roe）缩小候选，再叠加技术条件，避免一上来就算指标。
2. **指标组合**：分析单股时不要只看一个指标——\`CalcIndicators\` 一次性算 MACD + KDJ + RSI + BOLL，再综合判断。
3. **信号验证**：用户问"金叉/死叉"等具体信号时，直接用 \`DetectSignals\`，比手算 MACD 后判断更准。
4. **回测前确认**：调 \`SimpleBacktest\` 之前先和用户确认时间区间和起始资金；K 线数据少于 250 个交易日时主动提醒回测参考性不足。
5. **公式异常**：\`EvalFormula\` 报错时优先排查公式语法（括号、引用列名、TDX 函数名），而不是怀疑数据源。

## 不要做

- 不要用 \`Bash\` 执行 Python 脚本去手算指标——已有 MCP 工具就别绕路。
- 不要把全市场筛选条件设得过于宽松（>500 只）后再算技术指标，会很慢；先收紧基本面条件。

## 依赖

- 需要 Python 3.10+ 和 pandas/numpy/akshare 依赖（首次启动会自动检测安装）
- Python Bridge 不可用时工具会返回明确的依赖安装指引
`;

const TEMPLATES: Record<string, { description: string; content: string }> = {
  'stock-analysis': {
    description:
      '股票技术指标计算、条件筛选、财务分析、技术信号检测、自定义公式执行、简单策略回测。',
    content: STOCK_ANALYSIS_SKILL_MD,
  },
};

export function listSkillTemplates(): SkillTemplateMeta[] {
  return Object.entries(TEMPLATES).map(([name, t]) => ({
    name,
    description: t.description,
  }));
}

/**
 * 把 Skill 模板订阅到工作区：写入 `<workspace>/.claude/skills/<name>/SKILL.md`。
 * overwrite=false 且 SKILL.md 已存在时抛 'SKILL_EXISTS' 让前端弹 confirm 后重试。
 */
export async function subscribeSkillTemplate(
  workspacePath: string,
  name: string,
  overwrite: boolean,
): Promise<void> {
  const template = TEMPLATES[name];
  if (!template) {
    throw new Error(`未知 Skill 模板: ${name}`);
  }
  const skillDir = path.join(workspacePath, '.claude', 'skills', name);
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!overwrite) {
    try {
      await fs.access(skillFile);
      throw new Error('SKILL_EXISTS');
    } catch (err) {
      if (err instanceof Error && err.message === 'SKILL_EXISTS') throw err;
      // 文件不存在，继续写入
    }
  }
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillFile, template.content, 'utf-8');
}
