/**
 * 记录型 JSON 文件条目级合并原语（零 Electron 依赖，供 apply.ts 的 merge registry 调用）
 *
 * 「两端各自追加条目」的记录文件（workspaces.json / conversations.json / groups.json / plans.json /
 * notifications.json）同步时不再整文件覆盖（3-way 覆盖天然丢一侧新增），改为按条目 id 并集 + 同 id 新者胜。
 * 合并幂等：并集 + 同键新者胜是幂等运算，两端各跑一次同步即收敛。
 *
 * 容错约定：任一侧结构不符合预期（非对象 / 缺记录数组或映射字段）→ 返回 null，由调用方降级走冲突挂起，
 * 绝不静默整文件覆盖。时间比较统一 updatedAt 优先、缺失时 fallback createdAt（notifications 条目无 updatedAt）；
 * 无法解析的时间值视为最旧，无法比较时保本端（保守）。
 */

export type ParsedJson = unknown;

export function asRecord(value: ParsedJson): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** ISO 8601 字符串或毫秒数均可；无法解析视为最旧（-Infinity） */
export function timeOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return -Infinity;
}

function entryTime(entry: Record<string, unknown>): number {
  return timeOf(entry.updatedAt ?? entry.createdAt);
}

/** 同键条目新者胜：updatedAt（fallback createdAt）较新的一方；无法比较/相等 → 保本端 */
export function pickNewerEntry(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): Record<string, unknown> {
  return entryTime(remote) > entryTime(local) ? remote : local;
}

/** 文件级 version 字段取两侧较大者（返回部分对象供 spread，无升级时返回空对象） */
function bumpVersion(local: Record<string, unknown>, remote: Record<string, unknown>): Record<string, unknown> {
  const lv = typeof local.version === 'number' ? local.version : 0;
  const rv = typeof remote.version === 'number' ? remote.version : 0;
  return rv > lv ? { version: rv } : {};
}

function recordId(rec: Record<string, unknown> | null, idField: string): string | null {
  const id = rec?.[idField];
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * Record 型记录文件（如 conversations.json：`{version, conversations: Record<id, entry>}`）：
 * 键并集，同键 updatedAt 新者胜。
 */
export function mergeRecordMapFile(
  local: ParsedJson,
  remote: ParsedJson,
  key: string,
): ParsedJson | null {
  const l = asRecord(local);
  const r = asRecord(remote);
  if (!l || !r) return null;
  const lItems = asRecord(l[key]);
  const rItems = asRecord(r[key]);
  if (!lItems || !rItems) return null;
  const merged: Record<string, unknown> = { ...lItems };
  for (const [id, rItem] of Object.entries(rItems)) {
    const lItem = asRecord(merged[id]);
    const rRec = asRecord(rItem);
    if (!lItem || !rRec) {
      merged[id] = rItem;
      continue;
    }
    merged[id] = pickNewerEntry(lItem, rRec);
  }
  return { ...l, ...bumpVersion(l, r), [key]: merged };
}

/**
 * 数组型记录文件（groups.json `groups[]`、plans.json `tasks[]`、notifications.json `entries[]`）：
 * 按 idField 并集，同 id updatedAt 新者胜。无有效 id 的对端条目无法安全合并，丢弃（异常数据不入库）。
 */
export function mergeArrayFile(
  local: ParsedJson,
  remote: ParsedJson,
  key: string,
  idField: string,
): ParsedJson | null {
  const l = asRecord(local);
  const r = asRecord(remote);
  if (!l || !r) return null;
  const lArr = Array.isArray(l[key]) ? l[key] : null;
  const rArr = Array.isArray(r[key]) ? r[key] : null;
  if (!lArr || !rArr) return null;
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of lArr) {
    const rec = asRecord(raw);
    const id = recordId(rec, idField);
    if (rec && id) byId.set(id, rec);
  }
  for (const raw of rArr) {
    const rec = asRecord(raw);
    const id = recordId(rec, idField);
    if (!rec || !id) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? pickNewerEntry(prev, rec) : rec);
  }
  return { ...l, ...bumpVersion(l, r), [key]: [...byId.values()] };
}

/**
 * workspaces/workspaces.json：workspace id 并集。
 * 同 id：`path`/`additionalPaths`/`isDefault` 取本端（机器亲和——跨机路径灌入对端会打不开）；
 * `name`/`createdAt` 跟随 createdAt 更早一侧（稳定字段，两端收敛一致）；其余字段本端优先。
 */
export function mergeWorkspacesFile(local: ParsedJson, remote: ParsedJson): ParsedJson | null {
  const l = asRecord(local);
  const r = asRecord(remote);
  if (!l || !r) return null;
  const lArr = Array.isArray(l.workspaces) ? l.workspaces : null;
  const rArr = Array.isArray(r.workspaces) ? r.workspaces : null;
  if (!lArr || !rArr) return null;
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of lArr) {
    const rec = asRecord(raw);
    const id = recordId(rec, 'id');
    if (rec && id) byId.set(id, rec);
  }
  for (const raw of rArr) {
    const rec = asRecord(raw);
    const id = recordId(rec, 'id');
    if (!rec || !id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, rec);
      continue;
    }
    const earlier = timeOf(prev.createdAt) <= timeOf(rec.createdAt) ? prev : rec;
    byId.set(id, {
      ...rec, // 对端铺底：本端缺失的新字段可从对端补上
      ...prev, // 本端优先（机器亲和 + 未知字段保守）
      name: typeof earlier.name === 'string' ? earlier.name : prev.name,
      createdAt: earlier.createdAt ?? prev.createdAt,
    });
  }
  return { ...l, ...bumpVersion(l, r), workspaces: [...byId.values()] };
}
