import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSyncStore } from '@/stores/sync-store';
import { showConfirm } from '@/stores/confirm-store';
import { SYNC_ITEM_IDS, type SyncItemMeta } from '@/electron/main/services/settings-types';
import { DATA_ITEMS, syncStatusOf, WSID_TOKEN, type DataItem } from '@/electron/main/services/data-items';
import { UserSyncPathsSection } from './sync-user-paths';

/** 关闭 workspaces 的二次确认文案：影响面大（全部工作区数据不再跨设备），必须显式确认 */
async function confirmDisableWorkspaces(): Promise<boolean> {
  return showConfirm(
    '关闭工作区数据同步？',
    '关闭后所有工作区的会话、笔记、记忆等数据都不再跨设备，两端数据会逐渐分叉。确定关闭吗？',
  );
}

interface ScopeEntry {
  meta: SyncItemMeta;
  paths: string[];
}

/** ②工作区数据组 = 总开关 workspaces + tasks 细项（articles 已退役摘除）；其余同步项归 ①应用数据组 */
const WS_GROUP_IDS: ReadonlySet<string> = new Set(['workspaces', 'tasks']);

const dictItems: readonly DataItem[] = DATA_ITEMS;

const scopeEntries: ScopeEntry[] = (() => {
  const pathsByItem = new Map<string, string[]>();
  for (const item of dictItems) {
    if (!item.syncItemId) continue;
    const list = pathsByItem.get(item.syncItemId);
    if (list) list.push(...item.paths);
    else pathsByItem.set(item.syncItemId, [...item.paths]);
  }
  return SYNC_ITEM_IDS.map((meta) => ({ meta, paths: pathsByItem.get(meta.id) ?? [] }));
})();

/** 应用数据组：必选项（settings）置顶，其余保持字典顺序 */
const APP_SCOPE_ENTRIES = scopeEntries
  .filter((e) => !WS_GROUP_IDS.has(e.meta.id))
  .sort((a, b) => Number(b.meta.required === true) - Number(a.meta.required === true));
const WS_SCOPE_ENTRIES = scopeEntries.filter((e) => WS_GROUP_IDS.has(e.meta.id));
const LOCAL_ONLY_ITEMS = dictItems.filter((item) => syncStatusOf(item) === 'never' && item.localListHidden !== true);
const WS_PATH_PREFIX = `workspaces/${WSID_TOKEN}/`;

/** 同步范围四段式：①应用数据 ②工作区数据（组折叠）③用户文件 ④不同步的本机数据；文案全部由 DATA_ITEMS 字典派生 */
export function SyncScopeSection() {
  const syncOptions = useSyncStore((s) => s.syncOptions);
  const updateSyncOptions = useSyncStore((s) => s.updateSyncOptions);
  if (!syncOptions) return null;

  /**
   * 同步项统一切换：stocks/feishu 走独立布尔键（底层键不变），其余项增删 disabledSyncItems。
   * 修改即调 setSyncOptions，范围字段变化由主进程 syncOptionsRev++ 并随同步两端统一。
   */
  const toggleItem = async (meta: SyncItemMeta, on: boolean) => {
    if (meta.id === 'stocks') {
      await updateSyncOptions({ syncStocksData: on });
      return;
    }
    if (meta.id === 'feishu') {
      await updateSyncOptions({ syncFeishu: on });
      return;
    }
    if (!on && meta.id === 'workspaces') {
      const ok = await confirmDisableWorkspaces();
      if (!ok) return;
    }
    const current = syncOptions.disabledSyncItems ?? [];
    const next = on ? current.filter((id) => id !== meta.id) : [...current, meta.id];
    await updateSyncOptions({ disabledSyncItems: next });
  };

  const isItemOn = (meta: SyncItemMeta): boolean => {
    if (meta.id === 'stocks') return syncOptions.syncStocksData === true;
    if (meta.id === 'feishu') return syncOptions.syncFeishu === true;
    return !(syncOptions.disabledSyncItems ?? []).includes(meta.id);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm">同步范围</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          控制哪些数据参与设备同步，改动即时保存，随同步跨设备统一。
        </p>
      </div>

      <ScopeFoldGroup
        title="应用数据"
        hint="应用自身读写的数据，不依赖具体工作区"
        entries={APP_SCOPE_ENTRIES}
        isItemOn={isItemOn}
        onToggle={(meta, v) => void toggleItem(meta, v)}
      />

      <ScopeFoldGroup
        title="工作区数据"
        hint="路径前缀 workspaces/{wsid}/（{wsid} 为工作区 id）"
        entries={WS_SCOPE_ENTRIES}
        stripPathPrefix={WS_PATH_PREFIX}
        isItemOn={isItemOn}
        onToggle={(meta, v) => void toggleItem(meta, v)}
      />

      <div className="space-y-2">
        <SyncGroupTitle
          title="用户文件"
          hint="工作区里的代码、文档、文章库（dogear/articles/）等你自己的文件，走你的 git 或按目录勾选"
        />
        <UserSyncPathsSection syncOptions={syncOptions} />
      </div>

      <div className="space-y-2">
        <SyncGroupTitle title="不参与同步的本机数据" hint="仅存本机，不参与设备同步" />
        <div className="space-y-0.5 rounded-md border p-3">
          <ToggleRow
            checked={syncOptions.syncShadowGit === true}
            onChecked={(v) => void updateSyncOptions({ syncShadowGit: v })}
            label="同步影子快照仓库（shadow-git）"
            hint="本机文件历史的 git 安全网；跨设备共享可能因两端并发快照损坏，默认关闭"
          />
          <ToggleRow
            checked={syncOptions.syncConflictCopies === true}
            onChecked={(v) => void updateSyncOptions({ syncConflictCopies: v })}
            label="同步冲突留底副本（.conflict-*）"
            hint="同步冲突时保留的败方副本，默认仅留本机"
          />
        </div>
        <ul className="divide-y">
          {LOCAL_ONLY_ITEMS.map((item) => (
            <DataItemRow key={item.id} name={item.name} description={item.description} paths={item.paths} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ScopeFoldGroup({
  title,
  hint,
  entries,
  stripPathPrefix,
  isItemOn,
  onToggle,
}: {
  title: string;
  hint: string;
  entries: ScopeEntry[];
  stripPathPrefix?: string;
  isItemOn: (meta: SyncItemMeta) => boolean;
  onToggle: (meta: SyncItemMeta, on: boolean) => void;
}) {
  const closed = entries.filter((e) => !e.meta.required && !isItemOn(e.meta)).length;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left hover:bg-muted/50">
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">
          {entries.length} 项 · {closed === 0 ? '全部开启' : `已关 ${closed} 项`}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1.5 px-1 text-xs text-muted-foreground">{hint}</p>
        <ul className="mt-1 divide-y">
          {entries.map(({ meta, paths }) => (
            <DataItemRow
              key={meta.id}
              name={meta.name}
              description={meta.description}
              paths={
                stripPathPrefix
                  ? paths.map((p) => (p.startsWith(stripPathPrefix) ? p.slice(stripPathPrefix.length) : p))
                  : paths
              }
              required={meta.required === true}
            >
              <Switch
                className="shrink-0"
                checked={meta.required ? true : isItemOn(meta)}
                disabled={!!meta.required}
                onCheckedChange={(v) => onToggle(meta, v)}
              />
            </DataItemRow>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 字典条目明细行：名称 + 必选徽章 + 说明 + 路径模式；children 放右侧开关等控件 */
function DataItemRow({
  name,
  description,
  paths,
  required,
  children,
}: {
  name: string;
  description: string;
  paths: readonly string[];
  required?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{name}</span>
          {required && (
            <Badge variant="subtle" className="text-[10px]">
              必选
            </Badge>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground/70">{paths.join('、')}</div>
      </div>
      {children}
    </li>
  );
}

function SyncGroupTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function ToggleRow({
  checked,
  onChecked,
  label,
  hint,
}: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs leading-5 text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChecked} />
    </div>
  );
}
