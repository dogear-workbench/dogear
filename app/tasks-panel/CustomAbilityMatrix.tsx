import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { client } from '@/lib/client';
import type { AbilityPackView } from '../../electron/main/tipc/ability';

/** 能力包 key → 任务语境一句话说明（编辑页定制的直白文案，不用注册表里主/子会话语境的描述） */
const PACK_NOTES: Record<string, string> = {
  stock: '股票行情、分析、公告、候选池四组工具 + 股票分析与选股 skill',
  article: '文章解析入库 + 文章解析 skill',
  'web-mcp': 'GLM 联网搜索与网页读取，需在设置页配置 API Key',
  'code-workflow': '规划、实施、调试等开发流程 skill，按任务勾选挂载',
};

interface Props {
  workspaceId: string;
  toolPacksOverride: string[] | undefined;
  skillsOverride: string[] | undefined;
  onChange: (updates: { toolPacksOverride?: string[]; skillsOverride?: string[] }) => void;
}

/** 能力包映射到的工具包名（toolGroups 与可选工具包注册表的交集，滤掉 dogear-extension 这类 server 名） */
function toolPackNamesOf(pack: AbilityPackView, known: Set<string>): string[] {
  return (pack.toolGroups ?? []).filter((n) => known.has(n));
}

export function CustomAbilityMatrix({
  workspaceId,
  toolPacksOverride,
  skillsOverride,
  onChange,
}: Props) {
  const [packs, setPacks] = useState<AbilityPackView[]>([]);
  const [enabledNames, setEnabledNames] = useState<string[]>([]);
  const [knownNames, setKnownNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const [packsRes, toolPacksRes] = await Promise.all([
          client.getAbilityPacks(),
          client.listToolPacks({ workspaceId }),
        ]);
        if (cancelled) return;
        if ('error' in packsRes || !Array.isArray(toolPacksRes)) {
          setFailed(true);
          setPacks([]);
          setKnownNames(new Set());
          setEnabledNames([]);
          return;
        }
        setPacks(packsRes.packs.filter((p) => p.category === 'extension'));
        setKnownNames(new Set(toolPacksRes.map((p) => p.name)));
        setEnabledNames(toolPacksRes.filter((p) => p.enabled).map((p) => p.name));
      } catch {
        if (cancelled) return;
        setFailed(true);
        setPacks([]);
        setKnownNames(new Set());
        setEnabledNames([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (failed) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">扩展能力</label>
        <p className="text-xs text-muted-foreground">扩展能力加载失败，重新打开编辑页可重试。</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">扩展能力</label>
        <p className="text-xs text-muted-foreground">扩展能力加载中…</p>
      </div>
    );
  }

  const following = toolPacksOverride === undefined;
  const effective = new Set(following ? enabledNames : toolPacksOverride);
  const cwPack = packs.find((p) => p.key === 'code-workflow');
  const fourPacks = packs.filter((p) => p.key !== 'code-workflow');
  const cwExpandable = !!cwPack && cwPack.skillMetas.length > 0;
  const skillPicked = new Set(skillsOverride ?? []);
  const cwCheckedCount = cwPack
    ? cwPack.skillMetas.filter((m) => skillPicked.has(m.name)).length
    : 0;

  const toggleFourPack = (pack: AbilityPackView, on: boolean) => {
    const names = toolPackNamesOf(pack, knownNames);
    if (names.length === 0) return;
    const next = new Set(following ? enabledNames : toolPacksOverride);
    for (const n of names) {
      if (on) next.add(n);
      else next.delete(n);
    }
    onChange({ toolPacksOverride: [...next] });
  };

  const toggleCodeWorkflow = (on: boolean) => {
    if (!cwPack) return;
    if (!on) {
      onChange({ skillsOverride: undefined });
      return;
    }
    const names = cwPack.skillMetas.map((m) => m.name);
    onChange({ skillsOverride: [...new Set([...(skillsOverride ?? []), ...names])] });
  };

  const toggleSkill = (name: string, on: boolean) => {
    const current = skillsOverride ?? [];
    const next = on
      ? [...new Set([...current, name])]
      : current.filter((n) => n !== name);
    onChange({ skillsOverride: next.length > 0 ? next : undefined });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">扩展能力</label>
        {following ? (
          <Badge variant="subtle" className="text-[10px] px-1.5 py-0">跟随工作区</Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ toolPacksOverride: undefined })}
          >
            恢复跟随
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        默认跟绑定工作区的设置一致；拨动开关后按本任务自己的配置执行（保存任务后生效）。基础文件与搜索工具恒装，无需配置。
      </p>
      <div className="space-y-1.5">
        {fourPacks.map((pack) => {
          const names = toolPackNamesOf(pack, knownNames);
          const checked = names.length > 0 && names.every((n) => effective.has(n));
          return (
            <div key={pack.key} className="flex items-start gap-3 rounded-md border px-3 py-2">
              <span className="w-4 shrink-0" />
              <Switch
                className="mt-0.5 shrink-0"
                checked={checked}
                disabled={names.length === 0}
                onCheckedChange={(v) => toggleFourPack(pack, v)}
                aria-label={`${checked ? '关闭' : '开启'} ${pack.label}`}
              />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{pack.label}</span>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  {PACK_NOTES[pack.key] ?? pack.description}
                </p>
              </div>
            </div>
          );
        })}
        {cwPack && (
          <div className="rounded-md border">
            <div className="flex items-start gap-3 px-3 py-2">
              {cwExpandable ? (
                <button
                  type="button"
                  className="mt-1 shrink-0"
                  aria-expanded={expanded}
                  aria-label={expanded ? '收起代码工作流 Skill 细则' : '展开代码工作流 Skill 细则'}
                  onClick={() => setExpanded((v) => !v)}
                >
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 text-muted-foreground transition-transform',
                      !expanded && '-rotate-90',
                    )}
                  />
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <Switch
                className="mt-0.5 shrink-0"
                checked={cwCheckedCount > 0}
                disabled={!cwExpandable}
                onCheckedChange={toggleCodeWorkflow}
                aria-label={`${cwCheckedCount > 0 ? '关闭' : '开启'} ${cwPack.label}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{cwPack.label}</span>
                  {cwExpandable && (
                    <span className="text-xs text-muted-foreground/70">
                      Skill {cwCheckedCount}/{cwPack.skillMetas.length}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  {PACK_NOTES[cwPack.key] ?? cwPack.description}
                </p>
              </div>
            </div>
            {expanded && cwExpandable && (
              <div className="border-t border-border/60 bg-muted/10 px-3 py-2 space-y-1.5">
                <p className="text-xs text-muted-foreground">勾选的 skill 会在任务执行时按需加载。</p>
                <div className="flex flex-wrap gap-1.5">
                  {cwPack.skillMetas.map((skill) => {
                    const on = skillPicked.has(skill.name);
                    return (
                      <button
                        key={skill.name}
                        type="button"
                        aria-pressed={on}
                        title={skill.description ?? skill.name}
                        onClick={() => toggleSkill(skill.name, !on)}
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                          on
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                        )}
                      >
                        {skill.title ?? skill.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
