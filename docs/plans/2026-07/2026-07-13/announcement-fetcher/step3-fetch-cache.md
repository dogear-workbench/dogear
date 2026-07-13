---
step: 3
title: 全文抓取 + 懒缓存
status: pending
---

## 目标
`readAnnouncement(url, code, market)` 跑通两条路径：命中缓存直读 markdown；未命中下载 PDF → Python 解析 → 写缓存 → 返回。连续调两次同一 URL，第二次不下载不解析。

## 依赖上下文（接力棒输入）
- Step 1：`parseAnnouncementPdf(path)` 已在 `python-bridge.ts` 就绪，返回 `{ok, data?: {markdown}, error?}`
- Step 2：`announcement-service.ts` 已有 `listAnnouncements`；本 step 在同一文件加 `readAnnouncement`
- 全局决策：
  - 存储路径 `.dogear/stocks/announcements/{market}{code}/`
  - 文件 hash = `sha256(url).slice(0,16)`
  - index.json 条目：`{url, title, type, date, hash, cachedAt}`
- 现有 `safe-json.ts` 提供原子写 JSON 能力，index.json 用它写
- 现有 `getConfigDir()` 拿 `.dogear/` 根路径

## 计划改动

- [ ] `types/stock.ts` 加：
  - `interface AnnouncementDetail { url: string; markdown: string; cachedAt: string; fromCache: boolean; }`
  - `interface CachedAnnouncementEntry { url: string; title: string; type: AnnouncementType; date: string; hash: string; cachedAt: string; }`
- [ ] `electron/main/types.ts` 镜像
- [ ] `announcement-service.ts` 新增：
  - 私有：`getStorageDir(market, code)`：返回 `<configDir>/stocks/announcements/{market}{code}/`，不存在则 mkdir
  - 私有：`hashUrl(url)`：`crypto.createHash('sha256').update(url).digest('hex').slice(0,16)`
  - 私有：`validateCninfoUrl(url)`：只允许 `static.cninfo.com.cn` 开头（防 SSRF）
  - 私有：`readIndex(dir)`：读 `index.json`，不存在返回 `[]`
  - 私有：`writeIndex(dir, entries)`：`safe-json` 原子写
  - 私有：`downloadPdf(url, targetPath)`：fetch stream 到本地，检查大小上限（30MB，超出 reject）
  - 公开：`readAnnouncement(url, code, market, meta?): Promise<{ok, data?: AnnouncementDetail, error?}>`
    - meta 是 Step 2 的 Announcement 元数据（title/type/date），写 index 用；agent 应从 listAnnouncements 结果传入
    - 逻辑：validateCninfoUrl → hash → check `<hash>.md` 存在 → 命中读 md + 更新 fromCache=true 直返 / 未命中走下载+解析+写盘+写 index
- [ ] `announcement-service.ts` 加导出的 `clearAnnouncementCache(market, code)`：手动清理某只股的缓存目录（Step 3 只提供函数，UI 按钮留给未来）

## 验证

- [ ] 临时脚本连续调 2 次：
  ```ts
  const svc = await import('.../announcement-service.ts');
  const list = await svc.listAnnouncements('600519', 'sh', { limit: 3 });
  const url = list.data[0].url;
  const t1 = Date.now();
  const r1 = await svc.readAnnouncement(url, '600519', 'sh', list.data[0]);
  console.log('first:', Date.now() - t1, 'ms, fromCache=', r1.data.fromCache);
  const t2 = Date.now();
  const r2 = await svc.readAnnouncement(url, '600519', 'sh', list.data[0]);
  console.log('second:', Date.now() - t2, 'ms, fromCache=', r2.data.fromCache);
  ```
- [ ] 第一次：fromCache=false，耗时可能几秒（下载 + 解析）
- [ ] 第二次：fromCache=true，耗时 <50ms
- [ ] 检查 `.dogear/stocks/announcements/sh600519/` 目录：有 `<hash>.pdf` + `<hash>.md` + `index.json`
- [ ] index.json 内容合理（含 title/type/date/hash/cachedAt）
- [ ] 传一个非 cninfo URL 应报错（validateCninfoUrl 拦截）
- [ ] `bun run build:electron` + `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- PDF 大小上限最终值 + 超限行为：
- 改动文件清单：

### 给下一步的接力棒
- `readAnnouncement()` 最终签名和返回结构：
- markdown 输出的典型长度（决定 agent 工具要不要分页）：
- 缓存目录布局的真实样子（截图或 tree 输出）：
- 已知限制（比如某类公告解析后特别长/特别短）：
