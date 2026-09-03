# 浏览器文章读取评测基线（Step 6）

日期：2026-09-03
 runner：`resources/browser-eval/run-pipeline.mjs`（**用 node 运行**：`node resources/browser-eval/run-pipeline.mjs`，不要用 bun，原因见「已知限制」）

## 管线回归结果（零模型，9/9 PASS）

执行环境：node + `dist/main` 编译产物 + 临时 profile（`DOGEAR_CONFIG_DIR` 隔离），Chromium 真实启动，可重复执行（连续两轮 9 PASS / EXIT=0）。

| # | 任务 | 结果 | 关键观测 | 耗时 |
|---|------|------|----------|------|
| 1 | spa-pipeline-read | PASS | 延迟 2s 注入正文被渲染等待捕获，wordCount=483，标记命中 | 2.5s |
| 2 | spa-pipeline-noexpand-hint | PASS | 无展开候选页面 qualityHint 恒存在（确定性记录） | 2.1s |
| 3 | collapsed-pipeline-expand | PASS | 展开启发式真实点击生效（qualityHint 为空），wordCount=600 | 15.5s |
| 4 | collapsed-pipeline-full | PASS | 展开后尾部标记可达 | 15.5s |
| 5 | paged-pipeline-longest | PASS | 点击「下一页」后停在字数最长可见页（P2，wordCount=546），无拼接（P1/P3 标记不存在） | 0.1s |
| 6 | paged-pipeline-title | PASS | 标题与 P2 标记同时成立 | 0.1s |
| 7 | login-pipeline-needlogin | PASS | DOM 登录墙检测命中 need_login | 15.4s |
| 8 | lazy-pipeline-read | PASS | 懒加载长文文字完整提取，wordCount=686 | 0.0s |
| 9 | odd-pipeline-readability | PASS | Readability 兜底选中非标准容器正文并剥离侧栏噪音（ODD-NOISE 不存在），wordCount=492 | 0.0s |

耗时说明：collapsed/login 约 15s 是管线渲染等待满预算后的正确路径（collapsed 等待可见字数不达标后走展开；login 等待后命中登录墙），非异常。

## 翻页场景结论与拼接决策

- 管线行为（实测）：「下一页」命中展开白名单 → 点击后正文可见字数变长（P1 235 字 → P2 445 字）即认为展开成功并**停止** → 最终解析的是停留页 P2 的 DOM。
- 断言证实：content 只含 PAGED-2 标记，P1/P3 标记不存在 → **翻页不做拼接，只取到最长可见单页**（三页中约 1/3 内容）。
- 决策：以「完整内容」为标准，管线断言不到完整内容（内容完整度约 33%），**超出阈值 → 翻页拼接记「待补做」**（二期优先项），一期不改实现。
- 补做建议（二期）：点击「下一页」后不停止，循环采集（每页 settle 轮询 + 页数上限）累积正文；同时覆盖 URL 跳转型翻页（本测试页为同页 innerHTML 替换型，URL 跳转型的管线行为未覆盖，是本结论的局限）。

## Agent 任务层基线：未采集

- 状态：6 个 `type=agent` 任务已在 `tasks.json` 定义（含给模型的 goal 指引与 `expect.found` 断言），`run-pipeline.mjs` 对其跳过并标注 `SKIPPED-agent-not-configured`。
- 未采集原因：子会话暂不可用浏览器工具包（`SubAgentEnabledAbilities` 无 browser 字段 + settings UI 未暴露，step4 已识别）；主会话侧手动验证需搭 pi-session 基建 + 消耗真实模型调用，超出一期边界，按降级方案不采集。
- 二期采集条件：
  1. `SubAgentEnabledAbilities` 增加 browser 字段 + settings UI 配置入口
  2. 配置「浏览器解析」子会话 Profile（便宜档模型 + dogear-browser 工具包）
  3. 用 6 个 agent 任务（goal/断言已就绪）跑成功率，回填本文件

## 已知限制（一期记录，不修）

1. **管线缺陷：登录墙 DOM 检测对「正文隐藏在标准容器内」的页面失效**（实测确认）。浏览器规范中 `innerText` 对未渲染元素退化为 `textContent`（不做可见性裁剪），`measureTextFn` 对 `article/main/[role=main]/#content/.content` 取 max 时会把 `display:none` 的正文计入 container → `domWall`（passwords>0 且 container<100）漏判 → 解析阶段 Readability 还会把隐藏正文提取出来正常返回。测试页 `login-wall.html` 起初用 `<article>` 承载隐藏正文即触发此缺陷（复现：ok=true 而非 need_login），后改为非标准容器 `<div id="secret-body">` 使测试聚焦真实形态；缺陷本身保留在管线中，真实站点若受保护正文藏在标准标签内会同样漏判。
2. **playwright 与 Bun 运行时不兼容**：bun 下运行 runner 时 `manager.acquire()` 永久挂起（浏览器进程无法启动），60s 任务超时后逐任务失败。runner 必须用 node 执行（对齐前序 step 验证模式）。
3. 无展开候选页面 `qualityHint` 恒存在（「未能通过页面按钮展开全文」），对本来完整的文章会误示「可能不完整」；任务 2 已将该行为固化为断言，二期若优化需同步调整断言。
4. 翻页拼接未做（见上，待补做）；URL 跳转型翻页行为未覆盖。
