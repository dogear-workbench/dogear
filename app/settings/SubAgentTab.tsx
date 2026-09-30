import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, RotateCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Switch } from '@/components/ui/switch';
import { ModelSelector } from '@/components/ModelSelector';
import type { AbilityPackView } from '../../electron/main/tipc/ability';
import { AbilityBlockRow, ChannelSwitchItem, SkillCheckItem } from './subagent/AbilityBlockRow';
import {
  createDefaultSubAgentProfile,
  BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
  type AppSettings,
  type ModelSelection,
  type SubAgentProfile,
  type SubAgentEnabledAbilities,
} from '@/types/settings';

interface SubAgentTabProps {
  local: AppSettings;
  setLocal: (updater: (prev: AppSettings) => AppSettings) => void;
}

const BASIC_TOOLS = [
  { name: 'read', label: 'Read' },
  { name: 'write', label: 'Write' },
  { name: 'edit', label: 'Edit' },
  { name: 'bash', label: 'Bash' },
  { name: 'Glob', label: 'Glob' },
  { name: 'Grep', label: 'Grep' },
] as const;

const MIN_TIMEOUT = 1;
const MAX_TIMEOUT = 180;

/** 子会话无独立配置维度的包：主会话专属或按触发条件自动注入，不出块 */
const NON_PROFILE_PACK_KEYS = new Set(['notes', 'group-context', 'agent-collab']);

/** 单 Switch 块的包 key → enabledAbilities 字段（web-mcp 包字段名是 web） */
const SINGLE_FIELD_BY_PACK: Partial<Record<string, 'memory' | 'article' | 'web'>> = {
  memory: 'memory',
  article: 'article',
  'web-mcp': 'web',
};

interface SkillTemplateMeta { name: string; description: string; }
interface SkillEntry {
  source: 'builtin' | 'custom' | 'user'; name: string; description?: string;
  dir: string; enabled: boolean;
}

function clampTimeout(n: number): number {
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Math.round(n)));
}

function resolveModelLabel(local: AppSettings, sel: ModelSelection | null | undefined): string {
  if (!sel) return '默认模型';
  const profile = local.profiles[sel.profileId];
  if (!profile) return '默认模型';
  const matched = (profile.piModels ?? []).find(m => m.id === sel.tier);
  return matched ? (matched.label ?? matched.id) : '默认模型';
}

function countAbilityDomains(ab: SubAgentEnabledAbilities): number {
  let n = 1;
  if (ab.memory) n++;
  if (ab.stock) n++;
  if (ab.article) n++;
  if (ab.skills?.length) n++;
  if (ab.customSkills?.length) n++;
  if (ab.web) n++;
  if (ab.browser) n++;
  if (ab.extension) n++;
  return n;
}

// ── Profile Editor ───────────────────────────────────

function ProfileEditor({
  draft,
  updateDraft,
  templates,
  skills,
  packs,
  onRetryPacks,
  local,
}: {
  draft: SubAgentProfile;
  updateDraft: (updater: (prev: SubAgentProfile) => SubAgentProfile) => void;
  templates: SkillTemplateMeta[];
  skills: SkillEntry[];
  packs: AbilityPackView[] | null;
  onRetryPacks: () => void;
  local: AppSettings;
}) {
  const updateField = <K extends keyof SubAgentProfile>(key: K, value: SubAgentProfile[K]) => {
    updateDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateAbility = (key: keyof SubAgentEnabledAbilities, value: boolean | string[]) => {
    updateDraft((prev) => ({
      ...prev,
      enabledAbilities: { ...prev.enabledAbilities, [key]: value },
    }));
  };

  const ab = draft.enabledAbilities;
  const enabledSkills = ab.skills ?? [];
  const enabledCustomSkills = ab.customSkills ?? [];

  const templateNames = new Set(templates.map((t) => t.name));
  const customSkillList = skills.filter(
    (s) => (s.source === 'custom' || s.source === 'user') && !templateNames.has(s.name),
  );

  // 只增删给定名字：存量 skills 里其他域的 skill 名原样保留
  const writeArrayField = (field: 'skills' | 'customSkills', names: string[], on: boolean) => {
    const current = field === 'skills' ? enabledSkills : enabledCustomSkills;
    const next = on ? [...new Set([...current, ...names])] : current.filter((n) => !names.includes(n));
    updateAbility(field, next);
  };

  // 块开：双通道都关时双置 true（已开任一通道则不动）；块关：双清。细项勾选独立保存，重开即恢复
  const setBrowserBlock = (on: boolean) => {
    updateDraft((prev) => {
      const next = { ...prev.enabledAbilities };
      if (on && !next.browser && !next.extension) {
        next.browser = true;
        next.extension = true;
      } else if (!on) {
        next.browser = false;
        next.extension = false;
      }
      return { ...prev, enabledAbilities: next };
    });
  };

  const skillCheckItems = (pack: AbilityPackView) =>
    pack.skillMetas.map((meta) => (
      <SkillCheckItem
        key={meta.name}
        name={meta.name}
        title={meta.title}
        description={meta.description}
        checked={enabledSkills.includes(meta.name)}
        onToggle={() => writeArrayField('skills', [meta.name], !enabledSkills.includes(meta.name))}
      />
    ));

  const packDetailCount = (pack: AbilityPackView) =>
    `${pack.skillMetas.filter((m) => enabledSkills.includes(m.name)).length}/${pack.skillMetas.length}`;

  const renderPackBlock = (pack: AbilityPackView) => {
    if (pack.key === 'stock') {
      return (
        <AbilityBlockRow
          key={pack.key}
          title={pack.label}
          description={pack.description}
          checked={ab.stock === true}
          onCheckedChange={(v) => updateAbility('stock', v)}
          detailCount={packDetailCount(pack)}
          details={skillCheckItems(pack)}
        />
      );
    }
    if (pack.key === 'browser') {
      return (
        <AbilityBlockRow
          key={pack.key}
          title={pack.label}
          description={pack.description}
          checked={ab.browser === true || ab.extension === true}
          onCheckedChange={setBrowserBlock}
          detailCount={`${[ab.browser, ab.extension].filter(Boolean).length}/2`}
          details={
            <>
              <ChannelSwitchItem
                label="内嵌浏览器"
                description="dogear-browser 工具组（读文章/搜索/原子探索）"
                checked={ab.browser === true}
                onCheckedChange={(v) => updateAbility('browser', v)}
              />
              <ChannelSwitchItem
                label="浏览器扩展"
                description="dogear-extension 扩展工具组（真实浏览器已连接标签页，仅限已授权域名）"
                checked={ab.extension === true}
                onCheckedChange={(v) => updateAbility('extension', v)}
              />
            </>
          }
        />
      );
    }
    if (pack.key === 'code-workflow') {
      return (
        <AbilityBlockRow
          key={pack.key}
          title={pack.label}
          description={pack.description}
          checked={pack.skillMetas.some((m) => enabledSkills.includes(m.name))}
          onCheckedChange={(v) => writeArrayField('skills', pack.skillMetas.map((m) => m.name), v)}
          detailCount={packDetailCount(pack)}
          details={skillCheckItems(pack)}
        />
      );
    }
    const field = SINGLE_FIELD_BY_PACK[pack.key];
    if (!field) return null;
    return (
      <AbilityBlockRow
        key={pack.key}
        title={pack.label}
        description={
          pack.key === 'article'
            ? `${pack.description}；article-parser skill 随开关直通`
            : pack.key === 'memory'
              ? `${pack.description}；需工作区记忆包同开才装载`
              : pack.description
        }
        checked={ab[field] === true}
        onCheckedChange={(v) => updateAbility(field, v)}
      />
    );
  };

  const profilePacks = (packs ?? []).filter(
    (p) => p.type !== 'prompt-only' && !NON_PROFILE_PACK_KEYS.has(p.key),
  );

  const customNames = customSkillList.map((s) => s.name);

  return (
    <div className="space-y-4 p-4 rounded-lg border bg-muted/20">
      <div className="flex gap-4">
        <div className="flex-1 space-y-1.5">
          <label className="text-xs font-medium">名称</label>
          <input
            type="text"
            className="h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            value={draft.name}
            onChange={(e) => updateField('name', e.target.value)}
          />
        </div>
        <div className="w-32 space-y-1.5">
          <label className="text-xs font-medium">超时（分钟）</label>
          <input
            type="number"
            min={MIN_TIMEOUT}
            max={MAX_TIMEOUT}
            step={1}
            className="h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            value={draft.timeoutMinutes}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') return;
              updateField('timeoutMinutes', clampTimeout(Number(raw)));
            }}
            onBlur={(e) => updateField('timeoutMinutes', clampTimeout(Number(e.target.value)))}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">描述</label>
        <textarea
          className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[60px]"
          value={draft.description}
          onChange={(e) => updateField('description', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">模型</label>
        <p className="text-xs text-muted-foreground">
          子会话使用的模型。不指定时跟随主会话当前使用的模型，主会话未设置时用全局默认模型。
        </p>
        <ModelSelector
          settings={local}
          value={draft.modelSelection ?? null}
          onChange={(v) => updateField('modelSelection', v)}
          allowUnset={true}
          triggerVariant="block"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">基础工具</label>
        <div className="flex flex-wrap gap-3">
          {BASIC_TOOLS.map((tool) => (
            <label key={tool.name} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enabledBasicTools.includes(tool.name)}
                onChange={(e) => {
                  const tools = e.target.checked
                    ? [...draft.enabledBasicTools, tool.name]
                    : draft.enabledBasicTools.filter((t) => t !== tool.name);
                  updateField('enabledBasicTools', tools);
                }}
              />
              {tool.label}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">能力域</label>
        <p className="text-xs text-muted-foreground">
          此处为子会话侧子开关，实际生效 = 此处勾选 ∩ 工作区能力包总开关（设置 → 能力）：工作区关闭某能力包时，Profile 无法单独启用。
        </p>
        <div className="space-y-2">
          {!packs && (
            <div className="p-2 rounded-md border bg-background text-xs text-muted-foreground flex items-center gap-2">
              <span className="flex-1">能力包数据读取失败，无法渲染能力块</span>
              <button
                type="button"
                onClick={onRetryPacks}
                className="shrink-0 flex items-center gap-1 px-2 h-7 rounded-md border text-xs hover:bg-muted/50 transition-colors"
              >
                <RotateCw className="w-3 h-3" />
                重试
              </button>
            </div>
          )}
          {packs && profilePacks.map((pack) => renderPackBlock(pack))}
          {packs && customSkillList.length > 0 && (
            <AbilityBlockRow
              title="自定义 Skill"
              description="工作区内自定义的 skill（非内置模板）"
              checked={customNames.some((n) => enabledCustomSkills.includes(n))}
              onCheckedChange={(v) => writeArrayField('customSkills', customNames, v)}
              detailCount={`${customNames.filter((n) => enabledCustomSkills.includes(n)).length}/${customNames.length}`}
              details={customSkillList.map((sk) => (
                <SkillCheckItem
                  key={sk.dir}
                  name={sk.name}
                  description={sk.description}
                  checked={enabledCustomSkills.includes(sk.name)}
                  onToggle={() => writeArrayField('customSkills', [sk.name], !enabledCustomSkills.includes(sk.name))}
                />
              ))}
            />
          )}
          {packs && (
            <div className="p-2 rounded-md border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <Send className="w-4 h-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">交付通信</div>
                  <div className="text-xs text-muted-foreground">dogear-delegation（固定启用，不可关闭）</div>
                </div>
                <Switch className="shrink-0" checked disabled aria-label="交付通信（固定启用）" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────

export function SubAgentTab({ local, setLocal }: SubAgentTabProps) {
  const [templates, setTemplates] = useState<SkillTemplateMeta[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [packs, setPacks] = useState<AbilityPackView[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SubAgentProfile | null>(null);

  const loadPacks = useCallback(async () => {
    try {
      const res = await client.getAbilityPacks();
      if ('error' in res) throw new Error(String(res.error));
      setPacks(res.packs);
    } catch (e) {
      setPacks(null);
      toast.error('能力包数据读取失败，请在编辑器能力域区点击重试', { description: String(e) });
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
        client.listSkillTemplates().then((r: any) => (r?.templates ?? []) as SkillTemplateMeta[]),
        client.listSkills({ workspaceId: initial }).then((r: any) => (r?.skills ?? []) as SkillEntry[]),
      ]);
      if (cancelled) return;
      setTemplates(t);
      setSkills(s);
    })();
    return () => { cancelled = true; };
  }, [loadPacks]);

  const profiles = local.subAgent.profiles;

  const updateDraft = (updater: (prev: SubAgentProfile) => SubAgentProfile) => {
    setDraft((prev) => (prev ? updater(prev) : prev));
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
    setEditingId(newProfile.id);
    setDraft({ ...newProfile, enabledAbilities: { ...newProfile.enabledAbilities } });
  };

  const deleteProfile = (id: string) => {
    setLocal((prev) => ({
      ...prev,
      subAgent: { profiles: prev.subAgent.profiles.filter((p) => p.id !== id) },
    }));
    if (editingId === id) {
      setEditingId(null);
      setDraft(null);
    }
  };

  const startEdit = (profile: SubAgentProfile) => {
    setEditingId(profile.id);
    setDraft({ ...profile, enabledAbilities: { ...profile.enabledAbilities } });
  };

  const setProfileEnabled = (id: string, enabled: boolean) => {
    setLocal((prev) => ({
      ...prev,
      subAgent: {
        profiles: prev.subAgent.profiles.map((p) => (p.id === id ? { ...p, enabled } : p)),
      },
    }));
  };

  const commitDraft = () => {
    if (!draft) return;
    setLocal((prev) => ({
      ...prev,
      subAgent: {
        profiles: prev.subAgent.profiles.map((p) => (p.id === draft.id ? draft : p)),
      },
    }));
    setEditingId(null);
    setDraft(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  return (
    <div className="max-w-2xl mx-auto py-6 px-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">子会话派遣</h2>
        <p className="text-sm text-muted-foreground">
          管理子会话派遣 Profile。每个 Profile 定义一组工具、能力和模型配置，派遣子会话时可选择对应 Profile。
        </p>
      </div>

      <div className="space-y-3">
        {profiles.map((profile) => {
          if (editingId === profile.id && draft) {
            return (
              <div key={profile.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">编辑 Profile</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={commitDraft}
                      className="flex items-center gap-1 px-3 h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="flex items-center gap-1 px-3 h-8 rounded-md border text-xs hover:bg-muted/50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      取消
                    </button>
                  </div>
                </div>
                <ProfileEditor
                  draft={draft}
                  updateDraft={updateDraft}
                  templates={templates}
                  skills={skills}
                  packs={packs}
                  onRetryPacks={() => void loadPacks()}
                  local={local}
                />
              </div>
            );
          }

          const modelLabel = resolveModelLabel(local, profile.modelSelection);
          const toolCount = profile.enabledBasicTools.length;
          const domainCount = countAbilityDomains(profile.enabledAbilities);

          return (
            <div
              key={profile.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border bg-background hover:border-foreground/20 transition-colors',
                profile.enabled === false && 'opacity-60',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{profile.name}</span>
                  {profile.id === 'default' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      默认
                    </span>
                  )}
                  {profile.id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      内置
                    </span>
                  )}
                  {profile.enabled === false && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      已停用
                    </span>
                  )}
                </div>
                {profile.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{profile.description}</p>
                )}
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                  <span>工具 {toolCount}</span>
                  <span>能力域 {domainCount}</span>
                  <span>{modelLabel}</span>
                  <span>超时 {profile.timeoutMinutes}m</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {profile.id !== 'default' && (
                  <Switch
                    className="mr-1"
                    checked={profile.enabled !== false}
                    onCheckedChange={(v) => setProfileEnabled(profile.id, v)}
                    aria-label={profile.enabled !== false ? '停用该 Profile' : '启用该 Profile'}
                  />
                )}
                <button
                  type="button"
                  onClick={() => startEdit(profile)}
                  className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted/50 transition-colors"
                  title="编辑"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteProfile(profile.id)}
                  disabled={profile.id === 'default' || profile.id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID}
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                    profile.id === 'default' || profile.id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID
                      ? 'opacity-30 cursor-not-allowed'
                      : 'hover:bg-destructive/10 hover:text-destructive',
                  )}
                  title={
                    profile.id === 'default'
                      ? '默认 Profile 不可删除'
                      : profile.id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID
                        ? '内置 Profile 不可删除'
                        : '删除'
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addProfile}
        className="flex items-center gap-1.5 px-3 h-9 rounded-md border border-dashed text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        <Plus className="w-4 h-4" />
        添加 Profile
      </button>
    </div>
  );
}
