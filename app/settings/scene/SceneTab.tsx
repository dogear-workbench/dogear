import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { showConfirm } from '@/stores/confirm-store';
import { TASKS_TAB_ID, useSessionStore } from '@/stores/session-store';
import type { Workspace, WorkspaceConfig } from '@/types/electron-api';
import type { AbilityPackView } from '../../../electron/main/tipc/ability';
import type {
  SceneOverviewId,
  SceneOverviewRow,
  ScenePackCell,
} from '../../../electron/main/tipc/ability-scene';
import {
  EMPTY_CONFIG,
  applyPackToggle,
  applyScenePackToggle,
  applySkillToggles,
  buildSkillToPacks,
  createConfigPersister,
  packToggleLinksOf,
  type PackToggleLinks,
  type SceneOverrideKey,
  type SkillToPacks,
} from '../ability/config-mutations';
import { CATEGORY_FALLBACK } from '../ability/pack-meta';
import { SceneAbilityRow } from './SceneAbilityRow';
import { ScenePromptsPanel } from './ScenePromptsPanel';
import type { SettingsSearchEntry } from '../search-index';

export const SCENE_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { label: '场景能力总览', description: '控制每种会话加载哪些能力，全部能力启停唯一入口' },
  { label: '主会话能力', description: '主会话加载的能力包开关', keywords: ['主会话'] },
  { label: '子会话能力', description: '子会话派遣加载的能力包开关', keywords: ['派遣'] },
  { label: '任务执行会话能力', description: '协作任务执行会话的能力包开关' },
  { label: '定时任务能力', description: '定时任务运行会话的基础能力开关', keywords: ['scheduler'] },
  { label: '文章解析', description: '文章导入解析任务的固定提示词查看' },
  { label: '执行提示词模板', description: '任务执行会话的通用执行提示词' },
];

type OverviewResult = Exclude<Awaited<ReturnType<typeof client.getSceneOverview>>, { error: string }>;

/** 格子右上状态徽标：开关开着但最终没装上时提示 */
function statusBadge(cell: ScenePackCell): string | null {
  return cell.state === 'switchable' && cell.enabled && !cell.loaded ? '没装上' : null;
}

/** matrix 行 id → sceneOverrides 场景键；main 走 config 真源，不在此列 */
const SCENE_OVERRIDE_BY_ROW: Partial<Record<SceneOverviewId, SceneOverrideKey>> = {
  sub: 'sub',
  executor: 'executor',
  'scheduler-custom': 'scheduler',
};

interface SceneTabProps {
  onGoToSubAgent: () => void;
}

export function SceneTab({ onGoToSubAgent }: SceneTabProps) {
  const switchTab = useSessionStore((s) => s.switchTab);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [wsConfig, setWsConfig] = useState<WorkspaceConfig>(EMPTY_CONFIG);
  const [packs, setPacks] = useState<AbilityPackView[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<SceneOverviewId>('main');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadScene = useCallback(async (wsId: string) => {
    const [ovRes, cfgRes] = await Promise.all([
      client.getSceneOverview({ workspaceId: wsId }),
      client.getWorkspaceConfig({ workspaceId: wsId }),
    ]);
    if ('rows' in ovRes) {
      setOverview(ovRes);
      setOverviewError(null);
    } else {
      setOverview(null);
      setOverviewError(ovRes.error);
    }
    if (cfgRes && 'config' in cfgRes) setWsConfig(cfgRes.config ?? EMPTY_CONFIG);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [allRes, defaultWs, packsRes] = await Promise.all([
          client.getAll(),
          client.getDefault(),
          client.getAbilityPacks(),
        ]);
        if (cancelled) return;
        const list = allRes?.workspaces ?? [];
        const defaultId = defaultWs?.id ?? null;
        const initial = defaultId && list.some((w) => w.id === defaultId) ? defaultId : (list[0]?.id ?? null);
        setWorkspaces(list);
        setWorkspaceId(initial);
        setPacks('error' in packsRes ? [] : packsRes.packs);
        if (initial) await loadScene(initial);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadScene]);

  // 写回成功/失败都重拉真源：overview 反映装配结果，config 消除本地漂移
  const reloadAfterWrite = useCallback(async () => {
    if (!workspaceId) return;
    await loadScene(workspaceId);
  }, [workspaceId, loadScene]);

  const wsPersister = useMemo(
    () =>
      createConfigPersister({
        workspaceId,
        applyLocal: (patch) => setWsConfig((prev) => ({ ...prev, ...patch })),
        rollback: () => void reloadAfterWrite(),
        onSaved: () => void reloadAfterWrite(),
      }),
    [workspaceId, reloadAfterWrite],
  );

  const linksByKey = useMemo(() => {
    const m = new Map<string, PackToggleLinks>();
    for (const p of packs) m.set(p.key, packToggleLinksOf(p));
    return m;
  }, [packs]);

  const skillToPacks = useMemo<SkillToPacks>(() => buildSkillToPacks(packs), [packs]);

  const handleWorkspaceChange = async (id: string) => {
    setWorkspaceId(id);
    await loadScene(id);
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePackToggle = async (row: SceneOverviewRow, cell: ScenePackCell, enable: boolean) => {
    const scene = SCENE_OVERRIDE_BY_ROW[row.id];
    if (scene) {
      await wsPersister(applyScenePackToggle(wsConfig, scene, cell.key, enable));
      return;
    }
    await wsPersister(applyPackToggle(wsConfig, cell.key, linksByKey.get(cell.key), enable));
  };

  const handleSkillToggle = async (row: SceneOverviewRow, name: string, enable: boolean) => {
    await wsPersister(applySkillToggles(wsConfig, skillToPacks, [name], enable));
  };

  const goToTasksPanel = () => {
    switchTab(TASKS_TAB_ID);
  };

  const handleReset = async (row: SceneOverviewRow) => {
    if (row.id === 'main') {
      const ok = await showConfirm('恢复默认', `清空${row.label}行的全部手动开关，回到各包默认值。`);
      if (ok) await wsPersister({ abilityOverrides: {} });
      return;
    }
    const scene = SCENE_OVERRIDE_BY_ROW[row.id];
    if (!scene) return;
    const sceneOverrides = { ...(wsConfig.sceneOverrides ?? {}) };
    delete sceneOverrides[scene];
    const ok = await showConfirm('恢复默认', `删除「${row.label}」行的全部覆盖，回到跟随工作区配置。`);
    if (ok) await wsPersister({ sceneOverrides });
  };

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;
  const rows = overview?.rows ?? [];
  const categories = overview?.categories ?? CATEGORY_FALLBACK;
  const selectedRow = rows.find((r) => r.id === selectedSceneId) ?? null;

  const renderRow = (row: SceneOverviewRow, cell: ScenePackCell) => {
    const expandKey = `${row.id}:${cell.key}`;
    return (
      <SceneAbilityRow
        key={cell.key}
        cell={cell}
        badge={statusBadge(cell)}
        links={linksByKey.get(cell.key)}
        skillReady={packs.length > 0}
        expanded={expandedKeys.has(expandKey)}
        onToggleExpanded={() => toggleExpanded(expandKey)}
        onPackToggle={(enable) =>
          cell.skillName ? void handleSkillToggle(row, cell.skillName, enable) : void handlePackToggle(row, cell, enable)
        }
        onSkillToggle={(name, enable) => void handleSkillToggle(row, name, enable)}
      />
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 flex-wrap px-6 pt-5 pb-3">
        <div>
          <h2 className="text-lg font-semibold">场景</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            控制每种会话加载哪些能力
            {activeWorkspace ? `（当前工作区：${activeWorkspace.name}）` : ''}
            ；能力详情在能力页查看。
          </p>
        </div>
        <Select
          value={workspaceId ?? undefined}
          onValueChange={(v) => void handleWorkspaceChange(v)}
          disabled={workspaces.length === 0}
        >
          <SelectTrigger size="sm" className="w-[200px]" aria-label="选择工作区">
            <SelectValue placeholder={workspaces.length === 0 ? '暂无工作区' : '选择工作区'} />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
                {w.isDefault ? '（默认）' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {workspaces.length === 0 ? (
        <p className="px-6 text-sm text-amber-600 dark:text-amber-400">
          请先在工作区管理创建工作区后再配置场景能力。
        </p>
      ) : overviewError ? (
        <p className="px-6 text-sm text-destructive">场景总览读取失败：{overviewError}</p>
      ) : (
        <div className="flex-1 flex min-h-0">
          <nav className="w-52 shrink-0 border-r overflow-y-auto p-2 space-y-1" aria-label="场景列表">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedSceneId(row.id)}
                aria-current={row.id === selectedSceneId || undefined}
                className={cn(
                  'w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  row.id === selectedSceneId
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <span className="flex-1 truncate">{row.label}</span>
                {row.kind === 'summary' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">只读</span>
                )}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4">
            {selectedRow && (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">{selectedRow.label}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{selectedRow.description}</p>
                  </div>
                  {selectedRow.kind === 'matrix' && (
                    <div className="flex shrink-0 items-center gap-2">
                      {(selectedRow.id === 'executor' || selectedRow.id === 'scheduler-custom') && (
                        <Button variant="outline" size="sm" onClick={goToTasksPanel}>
                          前往任务面板
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void handleReset(selectedRow)}>
                        恢复默认
                      </Button>
                    </div>
                  )}
                </div>

                {selectedRow.kind === 'summary' ? (
                  <div className="mt-4">
                    <ScenePromptsPanel prompts={selectedRow.prompts ?? []} />
                  </div>
                ) : (
                  <>
                    <div className="mt-4 space-y-5">
                      {categories.map((cat) => {
                        const cells = selectedRow.packs.filter((p) => p.category === cat.key);
                        const groupNote = selectedRow.groupNotes?.[cat.key];
                        // 动态 skill 行只落 main，空态提示不进 sub/executor 行
                        const emptyCustomSkills =
                          cat.key === 'custom-skills' &&
                          cells.length === 0 &&
                          selectedRow.id === 'main';
                        if (cells.length === 0 && !groupNote && !emptyCustomSkills) return null;
                        return (
                          <section key={cat.key} className="space-y-2">
                            <h4 className="text-sm font-semibold">{cat.label}</h4>
                            {groupNote && (
                              <p className="text-xs text-muted-foreground leading-relaxed rounded-md border bg-muted/20 px-3 py-2 flex items-center gap-1 flex-wrap">
                                {groupNote}
                                {selectedRow.id === 'sub' && (
                                  <button
                                    type="button"
                                    onClick={onGoToSubAgent}
                                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                  >
                                    前往子会话派遣页
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                )}
                              </p>
                            )}
                            {cells.length > 0 && (
                              <div className="space-y-1.5">{cells.map((cell) => renderRow(selectedRow, cell))}</div>
                            )}
                            {emptyCustomSkills && (
                              <p className="text-xs text-muted-foreground leading-relaxed rounded-md border border-dashed px-3 py-2">
                                暂无自定义 skill，可在能力页导入或让 AI 制作
                              </p>
                            )}
                          </section>
                        );
                      })}
                    </div>
                    {(selectedRow.prompts?.length || selectedRow.extensionNote) && (
                      <ScenePromptsPanel
                        prompts={selectedRow.prompts ?? []}
                        extensionNote={selectedRow.extensionNote}
                        className="mt-5"
                      />
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
