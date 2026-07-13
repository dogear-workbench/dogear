---
step: 3
title: 全文抓取 + 懒缓存
status: done
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

- [x] `types/stock.ts` 加：
  - `interface AnnouncementDetail { url: string; markdown: string; cachedAt: string; fromCache: boolean; }`
  - `interface CachedAnnouncementEntry { url: string; title: string; type: AnnouncementType; date: string; hash: string; cachedAt: string; }`
- [x] `electron/main/types.ts` 镜像 —— 实测放弃，见「与计划差异」
- [x] `announcement-service.ts` 新增：
  - 私有：`getStorageDir(market, code)`：返回 `<configDir>/stocks/announcements/{market}{code}/`，不存在则 mkdir
  - 私有：`hashUrl(url)`：`crypto.createHash('sha256').update(url).digest('hex').slice(0,16)`
  - 私有：`validateCninfoUrl(url)`：只允许 `static.cninfo.com.cn` 开头（防 SSRF）
  - 私有：`readIndex(dir)`：读 `index.json`，不存在返回 `[]`
  - 私有：`writeIndex(dir, entries)`：`safe-json` 原子写
  - 私有：`downloadPdf(url, targetPath)`：fetch stream 到本地，检查大小上限（30MB，超出 reject）
  - 公开：`readAnnouncement(url, code, market, meta?): Promise<{ok, data?: AnnouncementDetail, error?}>`
    - meta 是 Step 2 的 Announcement 元数据（title/type/date），写 index 用；agent 应从 listAnnouncements 结果传入
    - 逻辑：validateCninfoUrl → hash → check `<hash>.md` 存在 → 命中读 md + 更新 fromCache=true 直返 / 未命中走下载+解析+写盘+写 index
- [x] `announcement-service.ts` 加导出的 `clearAnnouncementCache(market, code)`：手动清理某只股的缓存目录（Step 3 只提供函数，UI 按钮留给未来）

## 验证

- [x] 临时脚本连续调 2 次：
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
- [x] 第一次：fromCache=false，耗时可能几秒（下载 + 解析）—— 实测 6474ms
- [x] 第二次：fromCache=true，耗时 <50ms —— 实测 1ms
- [x] 检查 `.dogear/stocks/announcements/sh600519/` 目录：有 `<hash>.pdf` + `<hash>.md` + `index.json`
- [x] index.json 内容合理（含 title/type/date/hash/cachedAt）
- [x] 传一个非 cninfo URL 应报错（validateCninfoUrl 拦截）
- [x] `bun run build:electron` + `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **`electron/main/types.ts` 镜像未落地**：Step 2 已实测确认该文件目前完全没有为 stock 域做过镜像，本目录（`stock-service.ts`/`stock-data-service.ts`/`announcement-service.ts` 自身）统一做法是类型内联定义在服务文件里，`types/stock.ts` 作为前端可见的独立副本手动保持同步（不是 import 关系，`RateLimiterStatus` 就是先例）。Step 3 沿用这一实测惯例：`AnnouncementDetail`/`CachedAnnouncementEntry` 同时加进 `types/stock.ts`（前端用）和 `announcement-service.ts`（后端内联，导出），不碰 `electron/main/types.ts`。
  2. **`validateCninfoUrl` 用 `URL` 解析而非字符串 `startsWith`**：计划写的是"只允许 `static.cninfo.com.cn` 开头"，实现上改成 `new URL(url).hostname === 'static.cninfo.com.cn' && protocol === 'http:'`，防止 `http://static.cninfo.com.cn.evil.com/x.pdf` 这类前缀绕过。
  3. **下载失败/超限时清理半成品文件**：计划未提到，`downloadPdf` 捕获异常后 `fs.unlink(targetPath)` 清掉写了一半的 PDF，避免脏文件把下次调用的 `<hash>.pdf` 判断搞混（虽然当前判定缓存命中只看 `.md` 是否存在，半成品 `.pdf` 不会造成误判，但留着无用大文件不合理，顺手清理）。
  4. 其余按计划执行，无功能性偏差。
- PDF 大小上限最终值 + 超限行为：**30MB**（`MAX_PDF_SIZE_BYTES = 30 * 1024 * 1024`）。检查两层：① 有 `content-length` 响应头且超限直接拒绝，不发起下载；② 边流式写入边累加字节数，即使服务端隐瞒/压缩了 `content-length`，写入过程中一旦累计超过上限也立即抛错。两种情况都会被外层 `rateLimiter.execute` 的下载函数捕获异常，`downloadPdf` 统一清理半成品文件后重新抛出，最终 `readAnnouncement` 落到 `{ ok: false, error: '读取公告全文失败: 公告 PDF 大小超出上限（30MB）' }`。
- 改动文件清单：
  - `types/stock.ts:236-252` — 新增 `AnnouncementDetail` / `CachedAnnouncementEntry`
  - `electron/main/services/stock/announcement-service.ts:14-19`（import 追加 `crypto`/`fs`/`parseAnnouncementPdf`）、`:44-61`（新增两个类型的内联镜像）、`:361-521`（新增「公告全文抓取 + 懒缓存」整段：`MAX_PDF_SIZE_BYTES` 常量 / `getStorageDir` / `hashUrl` / `validateCninfoUrl` / `getIndexPath` / `readIndex` / `writeIndex` / `readCachedMarkdown` / `downloadPdf` / 公开 `readAnnouncement` / 公开 `clearAnnouncementCache`）
  - `electron/main/services/stock/index.ts:8-14` — barrel 追加 `readAnnouncement`/`clearAnnouncementCache` 函数导出 + `AnnouncementDetail`/`CachedAnnouncementEntry` 类型导出

### 给下一步的接力棒
- `readAnnouncement()` 最终签名和返回结构：
  ```typescript
  function readAnnouncement(
    url: string,
    code: string,
    market: 'sh' | 'sz' | 'bj',
    meta?: Pick<Announcement, 'title' | 'type' | 'date'>,
  ): Promise<{ ok: true; data: AnnouncementDetail } | { ok: false; error: string }>

  interface AnnouncementDetail {
    url: string;
    markdown: string;
    cachedAt: string;   // ISO，首次缓存时间（命中缓存时取 index.json 里记录的原始时间，不是本次调用时间）
    fromCache: boolean;
  }
  ```
  `meta` 不传时 index.json 里对应条目的 `title`/`date` 落空串、`type` 落 `'other'`，不影响 markdown 正文本身的读取——只影响后续按 index.json 做列表展示时的元数据完整性，agent 调用时应始终从 `listAnnouncements` 结果里带上对应条目传入。
- markdown 输出的典型长度：本次验证样本（贵州茅台 1 页权益分派实施公告，含 1 张分红明细表）markdown 长度 **2231 字符**，属于短公告。年报/半年报这类几十页的公告体量会大得多（Step 1 交付已提示"文本层与表格内容重复"会进一步放大长度），后续若做 agent 工具读取公告全文，建议按页数或字符数分页/截断，不要假设都像验证样本这么短。
- 缓存目录布局的真实样子：
  ```
  .dogear/stocks/announcements/sh600519/
  ├── 92d61e3c82150761.md      # 解析后的 markdown 正文
  ├── 92d61e3c82150761.pdf     # 原始 PDF（151.6KB）
  └── index.json               # [{ url, title, type, date, hash, cachedAt }]
  ```
  `index.json` 实测内容：
  ```json
  [
    {
      "url": "http://static.cninfo.com.cn/finalpage/2026-06-22/1225379934.PDF",
      "title": "贵州茅台2025年年度权益分派实施公告",
      "type": "interim",
      "date": "2026-06-22",
      "hash": "92d61e3c82150761",
      "cachedAt": "2026-07-13T07:23:27.827Z"
    }
  ]
  ```
- 已知限制：
  - 缓存是否过期完全不判断——只要 `<hash>.md` 存在就永久命中缓存，不会因为源公告被巨潮更新（少见但非不可能，如更正公告）而失效。若未来需要强制刷新，只能靠 `clearAnnouncementCache(market, code)` 手动清空整只股票的缓存目录，没有单条公告级别的失效接口。
  - `downloadPdf` 内的 `rateLimiter.execute` 复用了列表查询同一个全局限流器实例，PDF 下载和 API 查询共享同一套令牌桶/滑动窗口/断路器，高并发批量抓取全文时会和列表查询互相挤占配额（符合"全局决策"里"共用现有令牌桶"的要求，但不是独立的下载专属限速）。
  - 命中缓存分支目前信任 `<hash>.md` 内容始终完整可用，不做二次校验（比如文件被意外截断/清空），理论上存在极小概率读到损坏的空文件当作正常缓存返回。
