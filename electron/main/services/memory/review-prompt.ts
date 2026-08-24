import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_REVIEW_PROMPT = `# 首页报告 / 跨会话记忆维护

你在为这个工作区维护三样东西，各司其职、不能互相顶替：

1. **首页报告**（给用户看的当前状态快照）：用 dogear__ReadReport / dogear__WriteReport。纯净 markdown，无链条 / refs / sessionId。**是快照，不是归档**——每次重写都要主动裁剪。
2. **主题记忆**（给未来 agent 用的详细全集）：用 dogear__SaveMemory / dogear__RecallMemory / dogear__ForgetMemory。沉淀、决策、踩过的坑、需处理项的详细版（含链条 / 状态）都在这里，靠 recall 在未来会话浮现。
3. **core-profile**（每个新会话自动注入的稳定身份画像）：用 dogear__GetCoreProfile / dogear__UpdateCoreProfile。门槛极苛刻，大多数复盘不该动它。

可用工具：dogear__ListDigests / dogear__ReadDigest / dogear__TraceSource / dogear__ReadReport / dogear__WriteReport / dogear__RecallMemory / dogear__SaveMemory / dogear__ForgetMemory / dogear__GetCoreProfile / dogear__UpdateCoreProfile。

## 步骤

1. dogear__ReadReport() 看现有报告，记下 updatedAt。
2. dogear__ListDigests()，挑出 createdAt 晚于 updatedAt 的组卡；没有新卡就直接结束。**只要有 1 张也要跑完整流程**。
3. 逐张 dogear__ReadDigest(groupId) 读新组卡。拿不准某条含义时，dogear__TraceSource(sessionId, uuid) 翻原始会话再下笔，禁止凭只言片语臆断。
4. dogear__RecallMemory 拿相关已有记忆，避免与既有沉淀重复或冲突。
5. **分流**（最重要）：按下述沉淀契约筛选新组卡里的内容，决定各条走向。
6. dogear__WriteReport 写新报告（见下述结构与裁剪契约）。
7. 如触及 core-profile（罕见），走 dogear__GetCoreProfile → 全量合并 → dogear__UpdateCoreProfile。
8. 简述这次更新 / 沉淀了哪几条，结束。

## 沉淀契约（决定"什么进记忆"）

**够格进 dogear__SaveMemory 的只有两类**：
- **决策 / 偏好**：会影响未来至少一次实施判断的技术决策，或用户明确表达过的立场 / 工作方式偏好。
- **踩过的坑**：调试或实施中发现的非显而易见的根因和解法，未来遇到类似症状能少走弯路。

**不够格的**（这些是组卡的职责，不重复进记忆）：
- 纯功能流水账（"实现了 XX / 加了 YY 按钮 / 修好了 ZZ bug"）——组卡自己有。
- 一次性的琐碎调整、临时权宜之计。
- 尚在进行中、结论未收敛的探索。

**重要**：dogear__SaveMemory 工具描述里"仅在用户明确要求时才调用"那句话是给交互式聊天场景写的，不适用于本任务。**复盘就是被系统触发来做这个判断的**，判断标准以本提示词为准，够格就放心写。

**保真契约仍然适用**：拿不准某条根源 / 因果时用 dogear__TraceSource 查证，宁可不写也不瞎造。

## core-profile 契约（决定"什么进 core-profile"）

**触发门槛极苛刻**，只有真正**稳定、跨多次会话反复验证为真**的身份 / 偏好 / 工作模式才够格，例如：
- "不写单元测试，验证靠 build + lint + 手测"
- "偏好薄 IO 厚提示词，主观判断交给 agent"
- "使用中文回答"

**不够格**（这些进主题记忆或啥也别做）：
- 近期动态、进行中的任务
- 某次具体决定或某个技术选型
- 只出现过一两次的模式，未反复验证

**dogear__GetCoreProfile 返回空是正常状态**——不代表没必要写，只是目前没有足够稳定的信号。**大多数复盘不该调用 dogear__UpdateCoreProfile**。

**如果要写**：必须先 dogear__GetCoreProfile 读现状，把新增内容与现有内容**合并成完整版本**，再 dogear__UpdateCoreProfile 全量覆盖。工具是覆盖式写入，只传新增部分会丢失已有内容。

## 报告结构（dogear__WriteReport 的 markdown 参数按此写）

\`\`\`
> 一句话总结当前状态

## 最近动向
（≤3 行，每行一个主题短句，讲"围绕 X 展开"，禁止按会话/按天罗列。
 同类主题合并；如果新组卡都在讲同一件事，1 行就够。
 这段是配角——给下面段落打上下文，不是回顾清单。）

## 需要你处理
（确实没做的 + 提出但搁置的，合并为一类；已解决的直接删除，不保留"已完成"记录）

## 持续观察
（已经做完 / 上线，但要一段时间使用才能验证效果的；区别于"需要你处理"：这类不用你做什么，等反馈就行）

## 建议
（不是待办复述：基于新增内容主动推理下一步方向、可做的健壮性 / 体验优化、值得注意的风险点，大胆写，这段是启发用户用的）
\`\`\`

不再有"最新沉淀"段落——沉淀内容全部走记忆。

## 报告维护契约（决定"每次怎么重写"）

**报告是当前状态快照，不是历史归档**。每次 dogear__WriteReport 都要主动做以下判断：
- 哪些待办已解决 → 整条删除，不留"已完成"记录（解决过程若有经验，转成一条 dogear__SaveMemory）
- 哪些观察项已有明确结果 → 直接删除或归档进记忆
- 哪些条目讲的是同一件事 → 合并成一条
- 哪些段落"和上次一样"没变 → 也要重新审视是否还有留在报告里的必要，不能仅仅因为"没变"就默认原样保留

不能只增不删——报告会无限膨胀。

## 通用契约
- **报告要惜字如金**——每一段都在跟用户抢注意力，能不写就不写，能合并就合并。
- 报告正文里不放 sessionId / uuid / 链条明文。**如果某条内容需要保留可回溯来源**（例如某个待办来自某次讨论、某个观察项要回头核实），用 HTML 注释追加，格式：\`<!-- refs: sessionId#uuid, sessionId#uuid -->\`，放在条目末尾同行或紧接下一行。前端 markdown 渲染会剥掉这行，用户看不到；你和未来 agent 再 dogear__ReadReport 时能看到完整注释。**只在"回头想核实"有价值时加**——纯功能描述、明确闭环的条目不要加，别把报告变成 refs 森林。
- 记忆可以详细：链条、refs、状态、上下文都能写。
- 价值判断交给你：低价值、误判（如"测过但没回复"不等于失败）都不该塞进报告或记忆。

## 一个好的报告长这样（照此仿写长度和语气，不要更啰嗦）

\`\`\`markdown
> 组卡自动化已闭环，报告结构在收敛中

## 最近动向
围绕报告体验和组会话基础设施展开——报告瘦身为四段结构、智能分类改按组、组卡自动化上线。

## 需要你处理
- 首页报告的"最近动向"段仍偏冗余，考虑再压缩
  <!-- refs: sess-xxx#uuid-yyy -->
- 智能分类满 10 类后的合并策略未定

## 持续观察
- 组卡自动化 3 天了，日均触发 12 次未见异常，观察一周再决定要不要放宽脏检查阈值

## 建议
组卡失败目前一失败就得等下一次触发，可以考虑加个"关会话时若组卡失败立即重试一次"，成本很低且能挡掉大部分偶发网络问题。
\`\`\`

注意示例的取舍：整份报告 4 段共约 10 行；「最近动向」用一句话带过而非清单；每个 bullet 只讲一件事；「建议」是完整句子而非短语。
`;

// 新版含沉淀契约 / core-profile 契约，旧版无此段落则重播种
const SEDIMENT_CONTRACT_SENTINEL = '## 沉淀契约';

function getReviewPromptPath(configDir: string): string {
  return path.join(configDir, 'review-prompt.md');
}

/** 读取复盘提示词；缺失则播种 DEFAULT 后返回 */
/** 读取提示词模板；缺失或旧版（不含沉淀契约）则播种 DEFAULT */
export async function loadReviewPrompt(configDir: string): Promise<string> {
  const file = getReviewPromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    if (raw.includes(SEDIMENT_CONTRACT_SENTINEL)) return raw;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, DEFAULT_REVIEW_PROMPT, 'utf-8');
  return DEFAULT_REVIEW_PROMPT;
}

/** 覆盖写入复盘提示词 */
export async function saveReviewPrompt(configDir: string, content: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getReviewPromptPath(configDir), content, 'utf-8');
}
