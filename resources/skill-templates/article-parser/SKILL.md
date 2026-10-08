---
name: article-parser
description: 从网络文章 HTML 中提取标题、正文、作者等结构化内容。当用户导入文章失败、解析质量不佳，或用户明确要求调整某平台解析逻辑时使用此 Skill。
---

# 文章解析 Skill

## 何时使用
- 后台 PARSE_ARTICLE 任务触发（脚本或 Readability 解析失败）
- 用户在对话中说"xx 平台解析不对""帮我改下 xx 脚本"

## 可用 MCP 工具（dogear-article-parse）
- dogear__ReadRawHtml / dogear__ReadCurrentContent — 看原料和已解析结果
- dogear__ListPlatformScripts / dogear__ReadPlatformScript — 看已有平台脚本
- dogear__RunPlatformScript — 试跑脚本（支持 scriptContent 试跑候选，不落盘）
- dogear__UpdatePlatformScript — 落盘脚本（仅在试跑通过后调用）
- dogear__SaveParsedArticle — 保存当前这篇文章的解析结果
- dogear__ReadParseHistory — 看最近的解析历史，辅助判断是否有规律性失败

## 调试循环

遇到解析问题时，严格按下列步骤：

1. **诊断**：dogear__ReadRawHtml 和 dogear__ReadCurrentContent 了解问题
2. **查旧**：dogear__ListPlatformScripts → 若有脚本则 dogear__ReadPlatformScript 读出来
3. **写候选**：基于 HTML 结构编写新/改进的 extract() 函数
   - 必须 from article_parser_sdk import，不允许 import os/requests 等
   - 返回 Result(title=..., content=..., author=..., site_name=...)
   - content 必须是 Markdown 格式
4. **试跑**：dogear__RunPlatformScript(scriptContent=候选源码) 试跑
   - 失败 → 读 traceback，修改，再试（最多 5 轮）
   - 成功 → 检查 title 非空、content ≥ 200 字符、内容合理
5. **落盘**：dogear__UpdatePlatformScript(platform, content=脚本最终版) 写入
6. **保存当前文章**：dogear__SaveParsedArticle(title, content, ...)

## 约束
- 脚本存在且有效时优先用脚本解析
- 不要为登录墙/反爬页面写脚本，直接报告失败
- dogear__UpdatePlatformScript 之前必须有一次成功的 dogear__RunPlatformScript
- 脚本保持精简，不追求覆盖所有边缘场景
- 禁止修改 SKILL.md 和 common.md（工具路径白名单已拒绝）

## 常识参考
common.md 里记录了通用的 HTML 预处理和元数据提取常识，可用 dogear__ReadParserRules 加载作为参考。
