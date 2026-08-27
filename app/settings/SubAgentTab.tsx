import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Switch } from '@/components/ui/switch';
import { ModelSelector } from '@/components/ModelSelector';
import {
  createDefaultSubAgentProfile,
  type AppSettings,
  type ModelSelection,
  type SubAgentProfile,
  type SubAgentEnabledAbilities,
} from '@/types/settings';

interface SubAgentTabProps {
  local: AppSettings;
  setLocal: (updater: (prev: AppSettings) => AppSettings) => void;
}

const CODE_WORKFLOW_TEMPLATES = [
  'brainstorming', 'codebase-map', 'doc-sync',
  'staged-execution', 'staged-impl', 'systematic-debugging',
];

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
  if (ab.reference) n++;
  return n;
}

function toggleInArray(arr: string[] | undefined, name: string): string[] {
  const current = arr ?? [];
  return current.includes(name)
    ? current.filter((n) => n !== name)
    : [...current, name];
}

// ── Profile Editor ───────────────────────────────────

const BOOLEAN_ABILITIES: {
  key: 'memory' | 'stock' | 'article' | 'reference';
  label: string;
  desc: string;
}[] = [
  { key: 'memory', label: '记忆系统', desc: 'dogear__RecallMemory / dogear__SaveMemory / dogear__ForgetMemory' },
  { key: 'stock', label: '股票分析', desc: '股票分析工具包' },
  { key: 'article', label: '文章', desc: '文章解析工具包' },
  { key: 'reference', label: '引用回溯', desc: 'dogear-reference' },
];

function ProfileEditor({
  draft,
  updateDraft,
  templates,
  skills,
  local,
}: {
  draft: SubAgentProfile;
  updateDraft: (updater: (prev: SubAgentProfile) => SubAgentProfile) => void;
  templates: SkillTemplateMeta[];
  skills: SkillEntry[];
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

  const codeWorkflowSkills = templates.filter((t) => CODE_WORKFLOW_TEMPLATES.includes(t.name));
  const templateNames = new Set(templates.map((t) => t.name));
  const customSkillList = skills.filter(
    (s) => (s.source === 'custom' || s.source === 'user') && !templateNames.has(s.name),
  );

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
        <div className="space-y-2">
          {BOOLEAN_ABILITIES.map((ab) => (
            <label
              key={ab.key}
              className="flex items-start gap-2 p-2 rounded-md border bg-background cursor-pointer hover:bg-muted/30 transition-colors"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!draft.enabledAbilities[ab.key]}
                onChange={(e) => updateAbility(ab.key, e.target.checked)}
              />
              <div>
                <div className="text-sm font-medium">{ab.label}</div>
                <div className="text-xs text-muted-foreground">{ab.desc}</div>
              </div>
            </label>
          ))}

          <div className="flex items-start gap-2 p-2 rounded-md border bg-muted/30">
            <input type="checkbox" className="mt-0.5" checked disabled />
            <div>
              <div className="text-sm font-medium">交付通信</div>
              <div className="text-xs text-muted-foreground">dogear-delegation（固定启用，不可关闭）</div>
            </div>
          </div>

          {codeWorkflowSkills.length > 0 && (
            <div className="p-2 rounded-md border bg-background space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground">代码工作流 Skill</div>
              {codeWorkflowSkills.map((tpl) => (
                <label
                  key={tpl.name}
                  className="flex items-start gap-2 cursor-pointer hover:bg-muted/30 rounded p-1 transition-colors"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={(draft.enabledAbilities.skills ?? []).includes(tpl.name)}
                    onChange={() => updateAbility('skills', toggleInArray(draft.enabledAbilities.skills, tpl.name))}
                  />
                  <div>
                    <div className="text-sm font-mono">{tpl.name}</div>
                    {tpl.description && (
                      <div className="text-xs text-muted-foreground">{tpl.description}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {customSkillList.length > 0 && (
            <div className="p-2 rounded-md border bg-background space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground">自定义 Skill</div>
              {customSkillList.map((sk) => (
                <label
                  key={sk.dir}
                  className="flex items-start gap-2 cursor-pointer hover:bg-muted/30 rounded p-1 transition-colors"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={(draft.enabledAbilities.customSkills ?? []).includes(sk.name)}
                    onChange={() => updateAbility('customSkills', toggleInArray(draft.enabledAbilities.customSkills, sk.name))}
                  />
                  <div>
                    <div className="text-sm font-mono">{sk.name}</div>
                    {sk.description && (
                      <div className="text-xs text-muted-foreground">{sk.description}</div>
                    )}
                  </div>
                </label>
              ))}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SubAgentProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      默认
                    </span>
                  )}
                  {profile.enabled === false && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
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
                  disabled={profile.id === 'default'}
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                    profile.id === 'default'
                      ? 'opacity-30 cursor-not-allowed'
                      : 'hover:bg-destructive/10 hover:text-destructive',
                  )}
                  title={profile.id === 'default' ? '默认 Profile 不可删除' : '删除'}
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
