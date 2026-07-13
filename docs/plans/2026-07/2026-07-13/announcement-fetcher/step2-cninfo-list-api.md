---
step: 2
title: 巨潮列表 API + orgId 映射
status: pending
---

## 目标
Service 层能列出任意 A 股股票的近期公告元数据。命令行给一个股票代码，返回 `[{title, type, date, url}]`。

## 依赖上下文（接力棒输入）
- Step 1 已让 Python 侧能解析 PDF——但本 step 不用 PDF，只调 JSON API
- 现有 `electron/main/services/stock/rate-limiter.ts` 已实现令牌桶 + 断路器 + 缓存，本 step 要在里面加巨潮 endpoint 配置
- 现有 stock-service.ts 的三数据源模式（腾讯/东财/新浪）可参考：怎么组织 fetch、怎么走 rate-limiter、错误怎么返
- 全局决策：返回 `{ok, data|error}` 契约；类型放 `types/stock.ts` 前端可见

## 计划改动

- [ ] `types/stock.ts` 新增：
  - `type AnnouncementType = 'annual' | 'quarterly' | 'semi_annual' | 'interim' | 'ipo' | 'other'`
  - `interface Announcement { url: string; title: string; type: AnnouncementType; date: string; code: string; market: string; }`
  - `interface ListAnnouncementsOpts { since?: string; until?: string; types?: AnnouncementType[]; limit?: number; }`
- [ ] `electron/main/types.ts` 镜像上述类型（参考现有其他类型的镜像做法）
- [ ] `electron/main/services/stock/announcement-service.ts` 新建：
  - 私有：`ensureOrgIdMap()`：首次运行拉三个 stock 列表（szse/sse/bj）合并存 `.dogear/stocks/cninfo-org-map.json`
  - 私有：`getOrgId(code, market)`：查本地 map；miss 时懒重抓；仍 miss 抛错
  - 私有：`inferMarket(code)`：从股票代码前缀推断（600/601/603 → sh，000/002/300 → sz，43/83/87 → bj）
  - 私有：`categoryFilter(types?)`：把类型枚举映射到巨潮 category 参数（多个用分号拼）
  - 私有：`inferType(cninfoCategory)`：从巨潮返回的 category 字段反推 AnnouncementType
  - 公开：`listAnnouncements(code, market, opts): Promise<{ok, data?: Announcement[], error?}>`：调 `POST http://www.cninfo.com.cn/new/hisAnnouncement/query`，解析响应组装 Announcement[]
- [ ] `rate-limiter.ts` 加 cninfo endpoint 配置（借鉴现有 eastmoney/tencent 的配置）
- [ ] `electron/main/services/stock/index.ts` barrel export 加 `announcement-service`

## 验证

- [ ] 临时脚本 `node -e` 或 `scripts/tmp/test-announcement-list.ts`：
  ```ts
  const svc = await import('./electron/main/services/stock/announcement-service.ts');
  const r = await svc.listAnnouncements('600519', 'sh', { limit: 10 });
  console.log(JSON.stringify(r, null, 2));
  ```
- [ ] 应返回 10 条茅台最近公告，每条含 title / type / date / url，type 分类合理（有年报、季报、临时公告混合）
- [ ] `since` 过滤生效（给 `since: '2026-01-01'` 只返回该日期后的）
- [ ] `.dogear/stocks/cninfo-org-map.json` 已创建，大小 > 10KB
- [ ] `bun run build:electron` 通过
- [ ] `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 巨潮 API 真实响应结构（贴关键字段）：
- category 映射的最终方案：
- 改动文件清单：

### 给下一步的接力棒
- `listAnnouncements()` 返回的 Announcement.url 具体是什么格式：
- orgId 映射懒加载的失败处理策略：
- 已知边界（比如新上市股/退市股/暂停上市股怎么表现）：
