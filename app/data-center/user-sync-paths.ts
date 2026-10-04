/**
 * 同步范围用户勾选树（syncOptions.userSyncPaths）的纯逻辑：
 * 勾选语义与主进程 manifest 对齐——列表条目是「整树」声明（目录条目覆盖其全部子孙），
 * 祖先在列即整树已同步，子孙独立条目冗余。路径均为 POSIX 相对路径（settings 层已清洗）。
 */

function isSelfOrAncestor(list: string[], relPath: string): boolean {
  return list.some((p) => p === relPath || relPath.startsWith(`${p}/`));
}

/** 路径勾选显示态：自身或任一祖先在列表 → 已勾（整树覆盖语义） */
export function isUserPathChecked(list: string[], relPath: string): boolean {
  return isSelfOrAncestor(list, relPath);
}

/** 祖先已在列（整树覆盖）时子项不可再单独操作，避免产生无意义冗余条目 */
export function isUserPathCoveredByAncestor(list: string[], relPath: string): boolean {
  return list.some((p) => relPath.startsWith(`${p}/`));
}

/** 子孙有独立勾选条目 → 半选态 */
export function hasUserPathCheckedDescendant(list: string[], relPath: string): boolean {
  return list.some((p) => p.startsWith(`${relPath}/`));
}

/**
 * 切换勾选：on → 加入条目并清掉其子孙冗余；off → 移除条目及其全部子孙（含历史脏数据）。
 * 返回新数组（可能内容与原值相同，调用方据此决定是否发起保存）
 */
export function toggleUserSyncPath(list: string[], relPath: string, on: boolean): string[] {
  const rest = list.filter((p) => p !== relPath && !p.startsWith(`${relPath}/`));
  if (!on) return rest;
  return [...rest, relPath];
}

/** 列表内容是否与另一列表集合等价（顺序无关）：用于避免幂等保存触发 rev 自增 */
export function userSyncPathsListEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((p) => sb.has(p));
}

/** 该工作区的勾选列表（缺省空数组） */
export function userSyncPathsForWorkspaces(paths: Record<string, string[]> | undefined, wsid: string): string[] {
  return paths?.[wsid] ?? [];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
