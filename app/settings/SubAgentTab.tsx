import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import type { AbilityPackView } from '../../electron/main/tipc/ability';
import { ProfileEditor, type SkillEntry, type SkillTemplateMeta } from './subagent/ProfileEditor';
import {
  createDefaultSubAgentProfile,
  BUILTIN_SUB_AGENT_PROFILE_IDS,
  type AppSettings,
  type SubAgentProfile,
} from '@/types/settings';
import type { SettingsSearchEntry } from './search-index';

export const SUB_AGENT_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { label: '子会话派遣 Profile', description: '定义子会话可用的工具、能力域和模型，派遣时选用' },
  { label: '交付通信', description: '子会话向派出会话回传结果的固定启用能力' },
  { label: '内置预设', description: 'default/browser-parse/explore/stock 四个内置子会话预设', keywords: ['预设'] },
];

interface SubAgentTabProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

const isBuiltinProfile = (id: string) => BUILTIN_SUB_AGENT_PROFILE_IDS.includes(id);

const navItemCls =
  'flex items-center gap-2 text-left text-sm px-3 py-1.5 rounded-md transition-colors w-full';

export function SubAgentTab({ local, setLocal }: SubAgentTabProps) {
  const [templates, setTemplates] = useState<SkillTemplateMeta[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [packs, setPacks] = useState<AbilityPackView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadPacks = useCallback(async () => {
    try {
      const res = await client.getAbilityPacks();
      if ('error' in res) throw new Error(String(res.error));
      setPacks(res.packs);
    } catch (e) {
      setPacks(null);
      toast.error('能力包数据读取失败，请在右侧能力域区点击重试', { description: String(e) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPacks();
    (async () => {
      const [allRes, defaultWs] = await Promise.all([client.getAll(), client.getDefault()]);
      const list = allRes?.workspaces ?? [];
      const defaultId = defaultWs?.id ?? null;
      const initial =
        defaultId && list.some((w) => w.id === defaultId)
          ? defaultId
          : list[0]?.id ?? null;

      const [t, s] = await Promise.all([
        client.listSkillTemplates().then((r) => (r?.templates ?? []) as SkillTemplateMeta[]),
        client.listSkills({ workspaceId: initial }).then((r) => (r?.skills ?? []) as SkillEntry[]),
      ]);
      if (cancelled) return;
      setTemplates(t);
      setSkills(s);
    })();
    return () => { cancelled = true; };
  }, [loadPacks]);

  const profiles = local.subAgent.profiles;

  // 选中项不存在（被删/初始）时回退到第一个 Profile
  useEffect(() => {
    if (profiles.length === 0) return;
    if (!profiles.some((p) => p.id === selectedId)) setSelectedId(profiles[0].id);
  }, [profiles, selectedId]);

  const updateProfile = (id: string, updater: (prev: SubAgentProfile) => SubAgentProfile) => {
    setLocal((prev) => ({
      ...prev,
      subAgent: {
        profiles: prev.subAgent.profiles.map((p) => (p.id === id ? updater(p) : p)),
      },
    }));
  };

  const addProfile = () => {
    const base = createDefaultSubAgentProfile();
    const newProfile: SubAgentProfile = {
      ...base,
      id: crypto.randomUUID(),
      name: '新 Profile',
      description: '',
    };
    setLocal((prev) => ({
      ...prev,
      subAgent: { profiles: [...prev.subAgent.profiles, newProfile] },
    }));
    setSelectedId(newProfile.id);
  };

  const duplicateProfile = (profile: SubAgentProfile) => {
    const baseName = `${profile.name}副本`;
    const existing = new Set(profiles.map((p) => p.name));
    let name = baseName;
    let n = 2;
    while (existing.has(name)) name = `${baseName} ${n++}`;
    const copy: SubAgentProfile = { ...structuredClone(profile), id: crypto.randomUUID(), name };
    setLocal((prev) => ({
      ...prev,
      subAgent: { profiles: [...prev.subAgent.profiles, copy] },
    }));
    setSelectedId(copy.id);
  };

  const deleteProfile = async (profile: SubAgentProfile) => {
    const ok = await showConfirm(
      '删除 Profile',
      `「${profile.name}」将立即删除且无法恢复，确定继续？`,
    );
    if (!ok) return;
    setLocal((prev) => ({
      ...prev,
      subAgent: { profiles: prev.subAgent.profiles.filter((p) => p.id !== profile.id) },
    }));
  };

  const setProfileEnabled = (id: string, enabled: boolean) => {
    updateProfile(id, (prev) => ({ ...prev, enabled }));
  };

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const selectedBuiltin = selected ? isBuiltinProfile(selected.id) : false;
  const selectedEnabled = selected?.enabled !== false;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-4 shrink-0">
        <h2 className="text-lg font-semibold mb-1">子会话派遣</h2>
        <p className="text-sm text-muted-foreground">定义派遣子会话可用的工具、能力域和模型</p>
      </div>

      <div className="flex-1 min-h-0 flex items-stretch">
        <nav aria-label="Profile 列表" className="w-[220px] shrink-0 border-r border-border/40">
          <div className="py-3 pr-3 flex flex-col gap-0.5">
            {profiles.map((profile) => {
              const enabled = profile.enabled !== false;
              const isSelected = profile.id === selectedId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  className={cn(
                    navItemCls,
                    isSelected
                      ? 'bg-primary/10 text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    !enabled && 'opacity-55',
                  )}
                  onClick={() => setSelectedId(profile.id)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'w-[7px] h-[7px] rounded-full shrink-0',
                      enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                    )}
                  />
                  <span className="truncate">{profile.name}</span>
                  {isBuiltinProfile(profile.id) && (
                    <span className="text-[10px] leading-none bg-muted text-muted-foreground px-1.5 py-1 rounded shrink-0">
                      {profile.id === 'default' ? '默认' : '内置'}
                    </span>
                  )}
                </button>
              );
            })}
            <Button variant="outline" size="sm" className="mt-2 justify-start" onClick={addProfile}>
              <Plus className="w-4 h-4 mr-1" />
              新建 Profile
            </Button>
          </div>
        </nav>

        <div className="flex-1 min-w-0 max-w-[820px] pl-6 pr-6 py-3 overflow-y-auto">
          {selected ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <input
                  type="text"
                  className={cn(
                    'h-9 w-[200px] px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring',
                    selectedBuiltin && 'opacity-60 cursor-not-allowed',
                  )}
                  value={selected.name}
                  disabled={selectedBuiltin}
                  onChange={(e) => updateProfile(selected.id, (prev) => ({ ...prev, name: e.target.value }))}
                />
                {selectedBuiltin && (
                  <span className="text-[10px] leading-none bg-muted text-muted-foreground px-1.5 py-1 rounded shrink-0">
                    内置 · 文案随版本更新
                  </span>
                )}
                <div className="flex-1" />
                {selected.id !== 'default' && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    {selectedEnabled ? '启用' : '停用'}
                    <Switch
                      checked={selectedEnabled}
                      onCheckedChange={(v) => setProfileEnabled(selected.id, v)}
                      aria-label={selectedEnabled ? '停用该 Profile' : '启用该 Profile'}
                    />
                  </label>
                )}
                {selectedBuiltin && (
                  <Button variant="outline" size="sm" onClick={() => duplicateProfile(selected)}>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    复制为副本
                  </Button>
                )}
                {!selectedBuiltin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => void deleteProfile(selected)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    删除
                  </Button>
                )}
              </div>
              <ProfileEditor
                key={selected.id}
                profile={selected}
                updateProfile={(updater) => updateProfile(selected.id, updater)}
                templates={templates}
                skills={skills}
                packs={packs}
                onRetryPacks={() => void loadPacks()}
                local={local}
                builtin={selectedBuiltin}
              />
            </>
          ) : (
            <div className="py-12 text-sm text-muted-foreground">在左侧选择或新建 Profile</div>
          )}
        </div>
      </div>
    </div>
  );
}
