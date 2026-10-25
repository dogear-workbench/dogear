import { Check, RotateCw, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { ModelSelector } from '@/components/ModelSelector';
import { EffortSelector } from '@/components/EffortSelector';
import type { AbilityPackView } from '../../../electron/main/tipc/ability';
import { AbilityBlockRow, SkillCheckItem } from './AbilityBlockRow';
import type {
  AppSettings,
  SubAgentEnabledAbilities,
  SubAgentProfile,
} from '@/types/settings';

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

/** 子会话无独立配置维度的包：主会话专属、场景层裁决（memory）或按触发条件自动注入，不出块 */
const NON_PROFILE_PACK_KEYS = new Set(['notes', 'group-context', 'agent-collab', 'memory']);

/** 单 Switch 块的包 key → enabledAbilities 字段（web-mcp 包字段名是 web，浏览器扩展沿用 extension 字段） */
const SINGLE_FIELD_BY_PACK: Partial<Record<string, 'article' | 'web' | 'extension'>> = {
  article: 'article',
  'web-mcp': 'web',
  'browser-extension': 'extension',
};

/** skill 细选块的包 key：块开关批量勾/取消包内全部 skill，细项在 Popover 单选 */
const SKILL_BLOCK_PACK_KEYS = new Set(['code-workflow']);

export interface SkillTemplateMeta { name: string; description: string; }
export interface SkillEntry {
  source: 'builtin' | 'custom'; name: string; description?: string;
  dir: string; enabled: boolean;
}

function clampTimeout(n: number): number {
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Math.round(n)));
}

function ToolChip({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors',
        checked
          ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/5'
          : 'text-muted-foreground hover:text-foreground hover:border-foreground/30',
      )}
    >
      {checked && <Check className="w-3 h-3" />}
      {label}
    </button>
  );
}

interface ProfileEditorProps {
  profile: SubAgentProfile;
  updateProfile: (updater: (prev: SubAgentProfile) => SubAgentProfile) => void;
  templates: SkillTemplateMeta[];
  skills: SkillEntry[];
  packs: AbilityPackView[] | null;
  onRetryPacks: () => void;
  local: AppSettings;
  builtin: boolean;
}

export function ProfileEditor({
  profile,
  updateProfile,
  templates,
  skills,
  packs,
  onRetryPacks,
  local,
  builtin,
}: ProfileEditorProps) {
  const updateField = <K extends keyof SubAgentProfile>(key: K, value: SubAgentProfile[K]) => {
    updateProfile((prev) => ({ ...prev, [key]: value }));
  };

  const updateAbility = (key: keyof SubAgentEnabledAbilities, value: boolean | string[]) => {
    updateProfile((prev) => ({
      ...prev,
      enabledAbilities: { ...prev.enabledAbilities, [key]: value },
    }));
  };

  const ab = profile.enabledAbilities;
  const enabledSkills = ab.skills ?? [];
  const enabledCustomSkills = ab.customSkills ?? [];

  const templateNames = new Set(templates.map((t) => t.name));
  const customDirSkills = skills.filter((s) => s.source === 'custom' && !templateNames.has(s.name));

  // 只增删给定名字：存量 skills 里其他域的 skill 名原样保留
  const writeArrayField = (field: 'skills' | 'customSkills', names: string[], on: boolean) => {
    const current = field === 'skills' ? enabledSkills : enabledCustomSkills;
    const next = on ? [...new Set([...current, ...names])] : current.filter((n) => !names.includes(n));
    updateAbility(field, next);
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

  const customSkillCheckItems = (list: SkillEntry[]) =>
    list.map((sk) => (
      <SkillCheckItem
        key={sk.dir}
        name={sk.name}
        description={sk.description}
        checked={enabledCustomSkills.includes(sk.name)}
        onToggle={() => writeArrayField('customSkills', [sk.name], !enabledCustomSkills.includes(sk.name))}
      />
    ));

  const customSkillBlock = (list: SkillEntry[], title: string, description: string) => (
    <AbilityBlockRow
      title={title}
      description={description}
      checked={list.some((s) => enabledCustomSkills.includes(s.name))}
      onCheckedChange={(v) => writeArrayField('customSkills', list.map((s) => s.name), v)}
      detailCount={`${list.filter((s) => enabledCustomSkills.includes(s.name)).length}/${list.length}`}
      details={customSkillCheckItems(list)}
    />
  );

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
        />
      );
    }
    if (SKILL_BLOCK_PACK_KEYS.has(pack.key)) {
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
          pack.key === 'article' ? `${pack.description}；article-parser skill 随开关直通` : pack.description
        }
        checked={ab[field] === true}
        onCheckedChange={(v) => updateAbility(field, v)}
      />
    );
  };

  const profilePacks = (packs ?? []).filter(
    (p) => p.type !== 'prompt-only' && !NON_PROFILE_PACK_KEYS.has(p.key),
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">描述</label>
          {builtin && <span className="text-xs text-muted-foreground">内置文案，随版本更新</span>}
        </div>
        <textarea
          className={cn(
            'w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[60px]',
            builtin && 'opacity-60 cursor-not-allowed',
          )}
          value={profile.description}
          disabled={builtin}
          onChange={(e) => updateField('description', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-4">
        <div className="space-y-1.5 min-w-0">
          <label className="text-xs font-medium">模型</label>
          <p className="text-xs text-muted-foreground">
            子会话使用的模型。不指定时跟随主会话当前使用的模型，主会话未设置时用全局默认模型。右侧选择思考投入档位：「跟随预设」按模型定档与全局默认执行。
          </p>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <ModelSelector
                settings={local}
                value={profile.modelSelection ?? null}
                onChange={(v) => updateField('modelSelection', v)}
                allowUnset={true}
                triggerVariant="block"
              />
            </div>
            <div className="w-32 shrink-0">
              <EffortSelector
                variant="block"
                value={profile.modelSelection?.effort ?? null}
                unsetLabel="跟随预设"
                disabled={!profile.modelSelection}
                onChange={(v) => {
                  if (profile.modelSelection) updateField('modelSelection', { ...profile.modelSelection, effort: v });
                }}
              />
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">超时（分钟）</label>
          <p className="text-xs text-muted-foreground">单个子会话最长允许运行的时间</p>
          <input
            type="number"
            min={MIN_TIMEOUT}
            max={MAX_TIMEOUT}
            step={1}
            className="h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            value={profile.timeoutMinutes}
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
        <label className="text-xs font-medium">基础工具</label>
        <div className="flex flex-wrap gap-1.5">
          {BASIC_TOOLS.map((tool) => (
            <ToolChip
              key={tool.name}
              label={tool.label}
              checked={profile.enabledBasicTools.includes(tool.name)}
              onToggle={() => {
                const tools = profile.enabledBasicTools.includes(tool.name)
                  ? profile.enabledBasicTools.filter((t) => t !== tool.name)
                  : [...profile.enabledBasicTools, tool.name];
                updateField('enabledBasicTools', tools);
              }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">能力域</label>
        <p className="text-xs text-muted-foreground">
          此处为子会话侧子开关。股票、文章、联网与浏览器双通道由这里独立裁决，工作区能力包总开关（设置 → 能力）不约束子会话；代码工作流与浏览器方法论还需工作区对应包开启且勾选 skill。记忆等固定层能力归场景页「子会话」行配置。
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
          {packs && customDirSkills.length > 0 &&
            customSkillBlock(
              customDirSkills,
              '自定义 Skill',
              'custom/skills 目录下的技能，随「自定义资源」同步',
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
