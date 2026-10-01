import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { client } from '@/lib/client';

interface SkillOption {
  source: 'builtin' | 'custom' | 'user';
  name: string;
  description?: string;
}

interface Props {
  selected: string[] | undefined;
  onChange: (selected: string[] | undefined) => void;
}

export function CustomSkillsSection({ selected, onChange }: Props) {
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.listSkills({}).then((r) => {
      if (cancelled) return;
      setSkills('skills' in r ? (r.skills ?? []) : []);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setSkills([]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const picked = new Set(selected);

  const toggle = (name: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(name);
    else next.delete(name);
    onChange(next.size > 0 ? [...next] : undefined);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">扩展能力（Skill）</label>
        {picked.size === 0 && (
          <Badge variant="subtle" className="text-[10px] px-1.5 py-0">不挂载</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        勾选的 Skill 会在任务执行时全文写进任务提示词；不勾则不挂载。
      </p>
      <div className="space-y-1.5">
        {loading ? (
          <p className="text-xs text-muted-foreground px-1">Skill 列表加载中…</p>
        ) : skills.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">暂无可选 Skill</p>
        ) : (
          skills.map((s) => (
            <label
              key={s.name}
              className="flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
            >
              <Checkbox
                className="mt-0.5"
                checked={picked.has(s.name)}
                onCheckedChange={(v) => toggle(s.name, v === true)}
                aria-label={s.name}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono break-all">{s.name}</span>
                  {s.source !== 'builtin' && (
                    <Badge variant="subtle" className="text-[10px] px-1.5 py-0 shrink-0">自定义</Badge>
                  )}
                </div>
                {s.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
                )}
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
