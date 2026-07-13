---
step: 2
title: 巨潮列表 API + orgId 映射
status: done
---

## 目标
Service 层能列出任意 A 股股票的近期公告元数据。命令行给一个股票代码，返回 `[{title, type, date, url}]`。

## 依赖上下文（接力棒输入）
- Step 1 已让 Python 侧能解析 PDF——但本 step 不用 PDF，只调 JSON API
- 现有 `electron/main/services/stock/rate-limiter.ts` 已实现令牌桶 + 断路器 + 缓存，本 step 要在里面加巨潮 endpoint 配置
- 现有 stock-service.ts 的三数据源模式（腾讯/东财/新浪）可参考：怎么组织 fetch、怎么走 rate-limiter、错误怎么返
- 全局决策：返回 `{ok, data|error}` 契约；类型放 `types/stock.ts` 前端可见

## 计划改动

- [x] `types/stock.ts` 新增：
  - `type AnnouncementType = 'annual' | 'quarterly' | 'semi_annual' | 'interim' | 'ipo' | 'other'`
  - `interface Announcement { url: string; title: string; type: AnnouncementType; date: string; code: string; market: string; }`
  - `interface ListAnnouncementsOpts { since?: string; until?: string; types?: AnnouncementType[]; limit?: number; }`
- [x] ~~`electron/main/types.ts` 镜像上述类型~~ 改为跟随本目录其他 stock 服务文件的实际惯例（内联镜像在服务文件自己里），见「实际改动」
- [x] `electron/main/services/stock/announcement-service.ts` 新建（扁平函数导出，非 class）：
  - `ensureOrgIdMap()`：首次运行拉 2 个 stock 列表（szse 已合并全市场 + bj 冗余校验）存 `.dogear/stocks/cninfo-org-map.json`
  - `getOrgId(code)`：查本地 map；miss 时懒重抓；仍 miss 返回 null
  - `inferMarket(code)`：从股票代码前缀推断，覆盖 sh/sz/bj 主板+科创板+创业板+北交所新老代码段
  - `categoryFilter(types?)`：把类型枚举映射到巨潮 category 参数（多个用分号拼，未知类型放弃预过滤）
  - `inferType(cninfoCategory)`：从巨潮返回的 announcementType 字段反推 AnnouncementType
  - `listAnnouncements(code, market?, opts?): Promise<{ok, data?: Announcement[], error?}>`：调 `POST http://www.cninfo.com.cn/new/hisAnnouncement/query`，解析响应组装 Announcement[]
- [x] ~~`rate-limiter.ts` 加 cninfo endpoint 配置~~ 该文件没有按 endpoint 配置的结构，巨潮请求已复用现有全局 `rateLimiter` 单例（同腾讯/东财/新浪的用法），见「实际改动」
- [x] `electron/main/services/stock/index.ts` barrel export 加 `announcement-service`

## 验证

- [x] 临时脚本（用 `--experimental-loader` stub 掉 `electron` 模块以在纯 Node 下跑通 `app.isPackaged`）：
  ```ts
  const svc = await import('./electron/main/services/stock/announcement-service.ts');
  const r = await svc.listAnnouncements('600519', 'sh', { limit: 10 });
  console.log(JSON.stringify(r, null, 2));
  ```
- [x] 返回 10 条茅台最近公告，每条含 title / type / date / url；分类验证：annual/quarterly 各拉 5 条全部正确命中
- [x] `since` 过滤生效（`since: '2026-01-01'` 返回 30 条全部 `date >= '2026-01-01'`）
- [x] `.dogear/stocks/cninfo-org-map.json` 已创建，308.4KB（6212 条），远超 10KB
- [x] `bun run build:electron` 通过
- [x] `bun run lint` 通过（0 errors，83 个预存在 warning，无新增）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - orgId 映射源：`sse_stock.json` 不存在（404），实测 `szse_stock.json` 本身已合并沪深京全市场 6212 条（命名具有历史遗留误导性）；`bj_stock.json` 作为冗余补充源（579 条，与前者有重叠）保留双源校验，只拉 2 个文件不是 3 个
  - 日期字段：`seDate` 是单参数、`~` 分隔的区间（`"2026-01-01~2026-07-13"`），不是分开的 `sdate`/`edate`
  - `pageSize` 服务端硬顶 30，请求更大值也会被截断，需要翻页（加了 `MAX_PAGES=10` 安全上限防止类型过滤命中率低时无限翻页）
  - `market` 参数改为可选：`listAnnouncements(code, market?, opts?)`，不传时用 `inferMarket(code)` 兜底推断；这样 `inferMarket` 才有真实调用点，不是死代码（原计划里 market 必填会导致 inferMarket 从未被调用）
  - 类型镜像：`electron/main/types.ts` 目前完全没有镜像任何 stock 相关类型——本目录下 `stock-service.ts`/`stock-data-service.ts`/`formula-service.ts` 一致的实际做法是把类型内联定义在服务文件自己里面（避免 rootDir 限制），我跟随了这个更贴近的既有惯例，没有碰 `electron/main/types.ts`
  - `rate-limiter.ts` 未做任何改动：该文件里根本没有"按 endpoint 配置"的结构，`stock-service.ts` 里腾讯/东财/新浪三个数据源全部共用同一个全局 `rateLimiter` 单例，只是 `execute()` 调用时传不同的 cache key。巨潮请求已经用同样方式接入这个共享限流器（`cninfo:stocklist:*` / `cninfo:list:*` 前缀 key），符合"走现有令牌桶"的要求，但不需要新增配置项
  - 组织形式：没有做成 class（跟 `stockService`/`stockWatchlistService` 那种单例风格不一样），保持扁平函数导出——因为计划里验证脚本本身写的是 `svc.listAnnouncements(...)` 而不是 `svc.announcementService.listAnnouncements(...)`，且除了 orgId 内存缓存外没有其他需要类封装的状态
- 巨潮 API 真实响应结构（贴关键字段）：见下方独立章节
- category 映射的最终方案：见下方独立章节
- 改动文件清单：
  - `types/stock.ts`：新增 `AnnouncementType` / `Announcement` / `ListAnnouncementsOpts`
  - `electron/main/services/stock/announcement-service.ts`：新建，`listAnnouncements()` 主入口 + orgId 映射管理 + category/type 映射
  - `electron/main/services/stock/index.ts`：barrel 加 `listAnnouncements` 及三个类型的 export

### 巨潮 API 真实响应结构
- **orgId 映射**：`GET http://www.cninfo.com.cn/new/data/szse_stock.json` → `{"stockList":[{"code":"600519","pinyin":"gzmt","category":"A股","orgId":"gssh0600519","zwjc":"贵州茅台"}, ...]}`，6212 条覆盖沪深京全市场；`bj_stock.json` 同结构，579 条（与前者重叠，仅作双源校验补充）
- **列表查询**：`POST http://www.cninfo.com.cn/new/hisAnnouncement/query`，`Content-Type: application/x-www-form-urlencoded`，`Referer` 必须带（不带也能通但保险起见加了）
  - 请求体关键字段：`stock={code},{orgId}`、`column=sse|szse|bj`（不是计划猜的 sh/sz，是 sse/szse/bj）、`category=`（空=不过滤，或 `category_ndbg_szsh` 等已验证 ID，多个用 `;` 拼）、`pageNum`、`pageSize`（服务端硬顶 30）、`seDate=2026-01-01~2026-07-13`（单参数波浪号区间，不是 sdate+edate）
  - 响应关键字段：`{"totalAnnouncement":1277,"announcements":[{"secCode":"600519","announcementTitle":"...","announcementTime":1782057600000,"adjunctUrl":"finalpage/2026-06-22/1225379934.PDF","announcementType":"01010503||010113||011301", ...}]}`
  - **踩坑**：`announcementTime` 是"北京时间 0 点"对应的 UTC 毫秒时间戳，直接 `toISOString().slice(0,10)` 会比真实公告日期少一天（少 8 小时导致跨零点）。改成从 `adjunctUrl` 路径里正则提取日期段（`finalpage/(\d{4}-\d{2}-\d{2})/`），更准更简单
- **PDF 下载地址**：`http://static.cninfo.com.cn/` + `adjunctUrl`（已用 HEAD 请求验证 200 + `content-type: application/pdf`）

### category 映射的最终方案
- 服务端 `category` 请求参数：只对已验证的三类年报/半年报/季报生效
  - `annual` → `category_ndbg_szsh`
  - `semi_annual` → `category_bndbg_szsh`
  - `quarterly` → `category_yjdbg_szsh;category_sjdbg_szsh`（一季报+三季报合并，巨潮没有统一的"季报"分类 ID）
  - `ipo`/`interim`/`other` 没有稳定可验证的官方分类 ID，`categoryFilter()` 遇到未知类型直接放弃服务端预过滤（返回空串，取全量），交给客户端 `inferType()` 兜底过滤，正确性优先于效率
- 响应里的 `announcementType` 是 `||` 分隔的层级分类编码，`inferType()` 用 `includes` 判断（不依赖顺序/位置）：
  - 含 `010301` → annual（已用 category_ndbg_szsh 过滤结果验证：一致返回该编码）
  - 含 `010303` → semi_annual
  - 含 `010305`（一季报）或 `010307`（三季报）→ quarterly
  - 含 `010123` → ipo（用长鑫科技 688825 招股意向书系列公告验证，四条公告的编码里都含这个 tag，但各自最后一段编码不同，所以用 includes 而不是取最后一段）
  - 其余 → interim（临时公告，A 股信披术语里本身就是"非定期报告"的统称，作为默认桶）
  - `other` 只保留给 `announcementType` 为空/无法解析的兜底情况，正常响应几乎不会命中

### 给下一步的接力棒
- `listAnnouncements()` 返回的 `Announcement.url` 格式：`http://static.cninfo.com.cn/finalpage/{YYYY-MM-DD}/{fileId}.PDF`，直接可下载，Step 3 抓取时无需再拼接
- orgId 映射懒加载的失败处理策略：`getOrgId()` 内存 → 本地文件 → 远程拉取三级 fallback；本地命中失败会强制远程重抓一次（应对新上市股未同步的情况）；两次都 miss 返回 `null`，`listAnnouncements` 转成 `{ok:false, error:'未找到股票代码 xxx 对应的巨潮 orgId'}`。远程列表响应有条数校验（`< 5000` 判定截断丢弃重试，来自实测踩过一次真实截断到 3897 条的坑），配合 `rate-limiter.ts` 的指数退避重试自愈
- 已知边界：
  - **新上市股**：如果已经进了 `szse_stock.json`/`bj_stock.json`，`getOrgId` 直接命中；如果巨潮还没同步（极少数刚过会未挂牌的），本地 miss 会触发一次强制重抓，抓完还是 miss 就返回明确 error，不会静默返回空列表
  - **退市/暂停上市股**：orgId 映射文件里退市股会保留历史条目（实测 `000010` 显示为 `*ST美丽`），能查到 orgId，公告列表接口本身对已退市股票依然可查历史公告，不受影响
  - **market 推断覆盖范围**：`inferMarket()` 前缀表覆盖了主板/科创板/创业板/北交所新老代码段（600/601/603/605/688/689/900 → sh；000/001/002/003/200/201/300/301/302 → sz；430/83x/87x/920 → bj），B 股（900/200/201）也覆盖了但未做单独测试
  - **限流**：巨潮接口实测存在瞬时限流/截断（同一 URL 短时间内并发请求偶发返回不完整 JSON 或 404 错误页），已通过共享 `rateLimiter` 的令牌桶+重试兜底，正常单次调用无感知
