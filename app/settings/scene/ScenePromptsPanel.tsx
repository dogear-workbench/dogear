import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import type { SceneSummaryPrompt } from '../../../electron/main/tipc/ability-scene';

// 与 AbilityPackDetailPage 的 PROSE_DOWN_CLASS 同值（提示词正文对齐能力页的排版密度）
const PROSE_DOWN_CLASS = '[&.prose-sm]:text-xs [&_pre]:text-xs [&_th]:text-xs [&_td]:text-xs';

interface PromptSection {
  label: string;
  text: string;
}

type FetchedSections = Record<string, PromptSection[] | { error: string }>;

function PromptText({ text }: { text: string }) {
  return <MarkdownRenderer content={text} className={PROSE_DOWN_CLASS} />;
}

function PromptItem({ prompt, fetched }: { prompt: SceneSummaryPrompt; fetched?: PromptSection[] | { error: string } }) {
  return (
    <section className="rounded-md border overflow-hidden">
      <div className="px-3 py-2 bg-muted/30 border-b">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h4 className="text-sm font-semibold">{prompt.label}</h4>
          <span className="text-xs text-muted-foreground/80">{prompt.note}</span>
        </div>
      </div>
      <div className="px-3 py-2">
        {prompt.content ? (
          <PromptText text={prompt.content} />
        ) : !fetched ? (
          <p className="text-xs text-muted-foreground">加载中...</p>
        ) : 'error' in fetched ? (
          <p className="text-xs text-destructive">提示词读取失败：{fetched.error}</p>
        ) : (
          <div className="space-y-3">
            {fetched.map((s) => (
              <div key={s.label} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                <PromptText text={s.text} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

async function fetchSections(id: string): Promise<PromptSection[] | { error: string }> {
  if (id === 'state-extract') {
    const r = await client.getStateExtractPrompt();
    return 'error' in r
      ? { error: r.error ?? '读取失败' }
      : [
          { label: '固定角色语（运行时内置）', text: r.systemPrompt ?? '' },
          { label: '抽取模板（<configDir>/state-extract-prompt.md，可编辑）', text: r.template ?? '' },
        ];
  }
  if (id === 'parse-article') {
    const r = await client.getParseArticlePrompt();
    return 'error' in r
      ? { error: r.error ?? '读取失败' }
      : [
          { label: '解析提示词（取自 SKILL.md，与实际解析任务同源）', text: r.systemPrompt ?? '' },
          { label: 'SKILL.md 全文', text: r.skillMd ?? '' },
        ];
  }
  return { error: `未知提示词路由: ${id}` };
}

interface ScenePromptsPanelProps {
  prompts: SceneSummaryPrompt[];
  extensionNote?: string;
  className?: string;
}

/** 提示词展示面板：带 content 的随行直接渲染，其余按 id 走只读 tipc 路由拉取 */
export function ScenePromptsPanel({ prompts, extensionNote, className }: ScenePromptsPanelProps) {
  const [sections, setSections] = useState<FetchedSections>({});
  const fetchKey = prompts.filter((p) => !p.content).map((p) => p.id).join(',');

  useEffect(() => {
    const ids = fetchKey ? fetchKey.split(',') : [];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => [id, await fetchSections(id)] as const),
      );
      if (!cancelled) setSections(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  if (prompts.length === 0 && !extensionNote) return null;

  return (
    <div className={cn('space-y-4', className)}>
      {extensionNote && (
        <p className="text-xs text-muted-foreground leading-relaxed rounded-md border bg-muted/20 px-3 py-2">
          {extensionNote}
        </p>
      )}
      {prompts.map((p) => (
        <PromptItem key={p.id} prompt={p} fetched={sections[p.id]} />
      ))}
    </div>
  );
}
