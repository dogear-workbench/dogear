import { useCallback } from 'react';
import { ArrowLeft, ChevronRight, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { RuleFileEditor } from './RuleFileEditor';

interface CustomSkillDetailPageProps {
  name: string;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}

const SKILL_EMPTY_HINT =
  '---\nname: my-skill\ndescription: 一句话说明这个技能做什么、什么时候用\n---\n\n# 技能用法\n';

export function CustomSkillDetailPage({ name, onBack, onRefresh }: CustomSkillDetailPageProps) {
  const read = useCallback(() => client.readCustomSkill({ name }), [name]);
  const write = useCallback((content: string) => client.writeCustomSkill({ name, content }), [name]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>
        <span className="text-sm text-muted-foreground">能力</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">自定义技能</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-medium font-mono truncate">{name}</span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 overflow-y-auto">
        <div className="flex items-start gap-3 shrink-0">
          <div className="rounded-md bg-muted/60 p-2 shrink-0">
            <Puzzle className="w-5 h-5 text-foreground/80" />
          </div>
          <div className="space-y-1 min-w-0">
            <h3 className="text-base font-semibold font-mono truncate">{name}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              自定义技能 · SKILL.md
            </p>
          </div>
        </div>

        <RuleFileEditor
          title={`技能 ${name}`}
          emptyHint={SKILL_EMPTY_HINT}
          read={read}
          write={write}
          onSaved={onRefresh}
        />
      </div>
    </div>
  );
}
