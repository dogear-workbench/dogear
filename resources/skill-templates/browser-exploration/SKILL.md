---
name: browser-exploration
description: 双通道浏览器调研方法论：公开网页与登录态站点均以内嵌浏览器（dogear__browser__*）为主，扩展通道（dogear__extension__*）为风控后备与用户真实浏览器协作。使用浏览器工具做网页调研前先加载本 skill。
---

# 浏览器探索 Skill

## 双通道分流

- 公开网页与登录态站点均以内嵌通道（dogear__browser__*）为主：readArticle 读文章、search 搜索是快档首选；快档失败时返回附页面位置（tabId + URL + 状态），页面保留在标签页中，直接转原子工具继续探索，不要重新导航。登录墙自动走「等待人工」（见下），完成后登录态持久化，后续会话直接可用。
- 内嵌触发风控熔断（危险信号累计）时停止操作并告知用户，用户同意后可改用扩展通道（dogear__extension__*，若已挂载）：作用在用户真实浏览器的已连接标签页（仅限已授权域名）。预算耗尽不是换通道的理由（预算按会话计、双通道共用，换通道同样被拒），应停止并如实告知用户。
- 扩展通道定位 = 用户真实浏览器协作 + 内嵌风控后备（Plan B），同一时间仅一个会话可用，被占用时会直接报错（不排队）；并行调研请改串行派遣。

## 探索循环

- 行动前先确认世界状态：observe_page / read_state 概要，不要凭记忆或假设直接操作。
- 每次下钻带明确假设；页面与预期不符时先 navigate 恢复到已知页面再继续，不把偏离当失败上报。
- 快档（readArticle / search）失败不白跑：从返回的页面位置接着用原子工具观察（observe_page / find / read_text / click / fill）。

## 人工介入（双通道模型不同，不要混淆）

- 内嵌通道：登录墙 / 人机验证（pageState 判定为 login_required / verification_required）或密码/提交类 guard 拦截（guard_password / guard_submit）时会产生「等待人工」卡片——页面已呈现在浏览器面板，告知用户完成后点「完成后继续」唤醒本会话，不要轮询重试。
- 扩展通道：没有「等待人工」卡片。guard_password / guard_submit 只返回错误文案，密码与提交由用户在自己的浏览器直接动手——告知用户需要人工操作什么，之后重新 observe_page 感知页面变化即可继续，不要等「完成后继续」信号。
- 内嵌页面被用户接管（user_takeover）时写操作会被拒绝：停下等待，交还后会收到继续提示。

## 站点档案（双通道，按本会话通道取用，勿混用工具名）

- navigate 返回提示本站有站点档案时，先取地图：内嵌通道调 dogear__browser__site_knowledge，扩展通道调 dogear__extension__site_knowledge（档案可能漂移，用时概要验证）。
- navigate 返回提示本站有访问策略时，先读本通道 site_policy（内嵌 dogear__browser__site_policy，扩展 dogear__extension__site_policy）：节奏与预算约束已自动生效，读指引是为了掌握推荐步骤与危险信号，避免误触熔断。
- 探索中发现新结构（状态路径 / 直链拼法 / 页面怪癖）用本通道的 site_finding 沉淀到档案：内嵌 dogear__browser__site_finding，扩展 dogear__extension__site_finding，供后续会话复用。

## 交付与停止

- 调研报告写完后、发交付前，把方法复盘中可复用的经验（站点结构 / 直链拼法 / 页面怪癖）用本通道 site_finding 写入站点档案，再交付。
- 调研完成后用 dogear__browser__present 把关键页面呈现给用户（页面即产物），再在回复里给结论。
- 同一页面连续 3 次探索失败即停，报告已发现的内容。
- 滑块/验证码即停，不规避、不绕过随机延迟。
