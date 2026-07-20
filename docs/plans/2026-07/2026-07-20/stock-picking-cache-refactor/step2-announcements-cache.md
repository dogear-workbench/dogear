---
step: 2
title: 公告列表当天缓存
status: done
---

## 目标

给 `listAnnouncements` 加"当天 key"缓存：同一天内对同一只股票的公告列表请求，首次调巨潮写盘，之后直接命中本地。隔天旧文件作废，下次调时新写。

## 依赖上下文

**现状**：
- 函数位置：`electron/main/services/stock/announcement-service.ts:313` `listAnnouncements(code, market?, opts)`
- 已有缓存：orgId 映射表（`cninfo-org-map.json`）+ 公告 PDF 全文（`{hash}.md`）
- 现有目录：`{configDir}/stocks/announcements/{market}{code}/`（PDF + md + index.json 都在这里）
- opts 参数：`since?: string` / `until?: string` / `types?: AnnouncementType[]` / `limit?: number`（默认 20）

**为什么选"当天 key + 全量存"而不是"参数 key"**：
- 参数组合太多（不同 since/limit/types 组合），缓存命中率低
- 简化为：**当天首次调时，忽略 opts 只按公司拉最近 6 个月 × 100 条**（覆盖绝大多数查询范围），写盘；后续同天内所有 opts 组合都用本地这份数据本地过滤

## 计划改动

### 改 `electron/main/services/stock/announcement-service.ts`

在 `listAnnouncements(code, market, opts)` 函数体开头加缓存层：

1. **归一化 market**：如果 opts 里 market 缺省，走原有的 `resolveMarket(code)` 推断逻辑
2. **计算今日 date**：`YYYY-MM-DD` 格式（本地时区）
3. **查缓存**：读 `{configDir}/stocks/announcements/{market}{code}/list.{today}.json`
   - 命中：parse 出全量列表，按 opts（since/until/types/limit）本地过滤，直接返回
   - 未命中：进下一步
4. **拉全量到本地**：调原有的巨潮 `hisAnnouncement/query`，参数用"近 6 个月 + limit=100"（比 opts 更宽），拿到全量
5. **写盘**：`list.{today}.json` 存全量 raw list（含 url/title/type/date/adjunctUrl 等原始字段）
6. **本地过滤后返回**

**缓存文件结构**：
```json
{
  "cachedAt": "2026-07-20T14:32:11.234Z",
  "market": "sz",
  "code": "000682",
  "range": { "since": "2026-01-20", "until": "2026-07-20", "limit": 100 },
  "items": [
    { "date": "2026-07-01", "title": "...", "type": "临时公告", "url": "http://...", "adjunctUrl": "..." },
    ...
  ]
}
```

**本地过滤逻辑**（新增纯函数）：
```ts
function filterCachedAnnouncements(
  items: CachedAnnouncementListItem[],
  opts: ListAnnouncementsOpts
): CachedAnnouncementListItem[] {
  let filtered = items;
  if (opts.since) filtered = filtered.filter(x => x.date >= opts.since);
  if (opts.until) filtered = filtered.filter(x => x.date <= opts.until);
  if (opts.types?.length) filtered = filtered.filter(x => opts.types!.includes(x.type));
  return filtered.slice(0, opts.limit ?? 20);
}
```

**边界处理**：
- 如果用户请求 since 早于缓存 range.since → 缓存不完整，走真调（并覆写缓存）
- 缓存文件损坏（parse 错）→ 打日志，走真调
- 隔天旧文件不主动清理，只是不会再被读；如果目录堆积过多按需加清理逻辑（不在本 step 范围）

### 手动验证

- 第一次调 listAnnouncements("000682") → 走巨潮，看到 `list.2026-07-20.json` 生成
- 第二次调 listAnnouncements("000682", "sz", { since: "2026-07-01" }) → 命中缓存，日志显示"cached"
- 改系统日期到明天再调 → 应该重新走巨潮（写 `list.2026-07-21.json`）
- 调 listAnnouncements("000682", "sz", { since: "2026-01-01" }) → since 早于缓存 range，走真调

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  1. `CachedAnnouncementListItem` 不含 `adjunctUrl` 字段（计划 JSON 示例里有），只保留 `url/title/type/date`——`adjunctUrl` 在现有代码里只用于推导 `date`，`url` 已是完整下载地址，没有下游消费者需要原始 `adjunctUrl`，保留只会是死字段。
  2. 顺手删除了因重构变成死代码的 `CATEGORY_IDS`/`categoryFilter`（服务端 category 预过滤）和 `buildSeDate`：因为宽范围拉取统一走 `category=''`（不做服务端类型预过滤，类型过滤全部交给本地 `filterCachedAnnouncements`），这两个函数在新流程里不再有调用点，留着会被 lint 判 unused。原 `fetchAnnouncementPage` 的 `category` 参数同步去掉，硬编码传空串。
  3. 缓存边界判定简化为只比较 `opts.since`（未处理 `opts.limit` 超过缓存 `WIDE_FETCH_LIMIT=100` 的情况）——这与 plan 文档"已知边界"里明确列出的范围一致，未扩大范围。
- 改动文件清单：
  - `electron/main/services/stock/announcement-service.ts` — 主要改动
  - `electron/main/services/stock/index.ts` — barrel 补充导出 `filterCachedAnnouncements` + `CachedAnnouncementListItem`

### 给下一步的接力棒

- 新增缓存文件结构：`AnnouncementListCache`（文件内部类型，未导出）= `{ cachedAt, market, code, range: { since, until, limit }, items: CachedAnnouncementListItem[] }`，落盘路径 `getAnnouncementListCachePath(market, code, dateKey)` → `.dogear/stocks/announcements/{market}{code}/list.{YYYY-MM-DD}.json`（复用已有的 `getStorageDir`）。
- 拉全量的具体参数（since/limit）：默认宽范围 `since = 今天往前 6 个月`（`monthsAgoDateKey(WIDE_RANGE_MONTHS=6)`）、`until = 今天`、`limit = WIDE_FETCH_LIMIT(100)`；若 `opts.since` 早于宽范围下界，则改用 `since = opts.since`、`limit = max(100, opts.limit ?? 0)` 做"真调"并覆写当天缓存。
- 本地过滤纯函数导出名（Step 3 预热服务会复用）：`filterCachedAnnouncements(items: CachedAnnouncementListItem[], opts: ListAnnouncementsOpts): CachedAnnouncementListItem[]`，已从 `announcement-service.ts` 和 barrel `index.ts` 双重导出，`CachedAnnouncementListItem` 类型同样双重导出。
- 已知边界/限制：
  - 隔天旧 `list.{date}.json` 不清理（计划明确不在本 step 范围）。
  - `opts.limit` 超过当天缓存条数（最多 100）不会触发重新拉取，只会返回缓存里已有的全部条数——这是 plan 文档里未覆盖的边界，跟 Step 1 财报缓存的"不完美但足够用"取舍一致，如后续需要可在 Step 3/4 按需扩展。
  - 缓存读命中判定只看 `opts.since` 下界，不比较 `opts.until`/`opts.types`，因为宽范围缓存天然覆盖到"今天"且包含所有类型，理论上不存在"缓存覆盖不了 until/types"的情况。
