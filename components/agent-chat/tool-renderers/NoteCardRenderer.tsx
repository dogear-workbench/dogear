import { ToolDetailShell, ToolSection, KeyValueList, OutputBox, ChipList } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

function toOutputText(toolOutput: any): string {
  if (typeof toolOutput === 'string') return toolOutput;
  return toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
}

function extractTitle(content: string): string {
  return content.split('\n')[0]?.replace(/^#{1,6}\s*/, '').trim() ?? '';
}

function toLinks(links: any): string[] {
  return Array.isArray(links) ? links.filter((l: any) => typeof l === 'string') : [];
}

function PreviewSection({ label, content }: { label: string; content: string }) {
  return (
    <ToolSection label={label}>
      <div className="whitespace-pre-wrap break-all text-foreground/90 max-h-40 overflow-y-auto bg-muted/30 rounded px-2 py-1.5">
        {content}
      </div>
    </ToolSection>
  );
}

export function NoteCardRenderer({ toolInput, toolOutput, isError }: Props) {
  const outputText = toOutputText(toolOutput);
  const noteId = typeof toolInput?.noteId === 'string' ? toolInput.noteId : '';
  const content = typeof toolInput?.content === 'string' ? toolInput.content : '';
  const patch = toolInput?.patch ?? null;

  const outputSection = outputText ? (
    <ToolSection label={isError ? '错误' : '输出'}>
      <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-32" />
    </ToolSection>
  ) : null;

  if (patch) {
    const patchTags = Array.isArray(patch.tags) ? patch.tags.filter((t: any) => typeof t === 'string') : [];
    const patchLinks = toLinks(patch.links);
    return (
      <ToolDetailShell>
        <ToolSection label="更新卡片">
          <KeyValueList data={{ 卡片: noteId }} />
        </ToolSection>
        {typeof patch.content === 'string' && <PreviewSection label="新正文" content={patch.content} />}
        {patchTags.length > 0 && (
          <ToolSection label="标签（整体替换）">
            <ChipList items={patchTags} />
          </ToolSection>
        )}
        {patchLinks.length > 0 && (
          <ToolSection label="引用（整体替换）">
            <KeyValueList data={Object.fromEntries(patchLinks.map((l: string, i: number) => [`${i + 1}`, l]))} />
          </ToolSection>
        )}
        {outputSection}
      </ToolDetailShell>
    );
  }

  if (noteId) {
    return (
      <ToolDetailShell>
        <ToolSection label="追加卡片">
          <KeyValueList data={{ 卡片: noteId }} />
        </ToolSection>
        {content && <PreviewSection label="追加片段" content={content} />}
        {outputSection}
      </ToolDetailShell>
    );
  }

  const title = extractTitle(content);
  const body = content.split('\n').slice(1).join('\n').trim();
  const tags = Array.isArray(toolInput?.tags) ? toolInput.tags.filter((t: any) => typeof t === 'string') : [];
  const links = toLinks(toolInput?.links);

  return (
    <ToolDetailShell>
      <ToolSection label="创建卡片">
        <div className="text-foreground font-medium break-all">{title || '（无标题）'}</div>
      </ToolSection>
      {tags.length > 0 && (
        <ToolSection label="标签">
          <ChipList items={tags} />
        </ToolSection>
      )}
      {links.length > 0 && (
        <ToolSection label="引用">
          <KeyValueList data={Object.fromEntries(links.map((l, i) => [`${i + 1}`, l]))} />
        </ToolSection>
      )}
      {body && <PreviewSection label="正文" content={body} />}
      {outputSection}
    </ToolDetailShell>
  );
}
